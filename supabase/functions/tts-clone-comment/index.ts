import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "no auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: "unauth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { commentId, voiceId: voiceIdOverride } = await req.json();
    if (!commentId) throw new Error("commentId required");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch comment and verify ownership
    const { data: comment, error: cErr } = await admin
      .from("sermon_comments")
      .select("id, user_id, comment_text, audio_url")
      .eq("id", commentId)
      .single();
    if (cErr || !comment) throw new Error("Comment not found");
    if (comment.user_id !== user.id) throw new Error("Not your comment");
    if (comment.audio_url) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Determine voice ID
    let voiceId = voiceIdOverride as string | undefined;
    if (!voiceId) {
      const { data: prefs } = await admin
        .from("user_preferences")
        .select("elevenlabs_voice_id")
        .eq("user_id", user.id)
        .maybeSingle();
      voiceId = prefs?.elevenlabs_voice_id || undefined;
    }
    if (!voiceId) throw new Error("No ElevenLabs voice ID configured");

    // Strip the [AI Coach] (category) prefix so it's not spoken
    let textToSpeak = comment.comment_text || "";
    textToSpeak = textToSpeak.replace(/^\s*\[AI Coach\]\s*(\([^)]*\)\s*)?/i, "").trim();
    if (!textToSpeak) throw new Error("Empty comment text");

    // Call ElevenLabs TTS — retry on 429 (concurrent_limit_exceeded) with backoff
    let ttsResp: Response | null = null;
    let lastErrText = "";
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const r = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: textToSpeak,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.85,
              style: 0.35,
              use_speaker_boost: true,
            },
          }),
        },
      );
      if (r.ok) {
        ttsResp = r;
        break;
      }
      lastErrText = await r.text();
      // Retry on 429 / concurrent-limit; otherwise abort immediately
      const isRate = r.status === 429 || /concurrent|rate_limit/i.test(lastErrText);
      console.error(`ElevenLabs attempt ${attempt + 1} failed`, r.status, lastErrText.slice(0, 200));
      if (!isRate || attempt === maxAttempts - 1) {
        throw new Error(`ElevenLabs ${r.status}: ${lastErrText.slice(0, 200)}`);
      }
      // Exponential backoff with jitter: 1.5s, 3s, 6s, 12s
      const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      await new Promise((res) => setTimeout(res, delay));
    }
    if (!ttsResp) throw new Error(`ElevenLabs failed after retries: ${lastErrText.slice(0, 200)}`);
    const audioBuf = await ttsResp.arrayBuffer();

    // Upload to storage
    const path = `${user.id}/ai-coach/${commentId}.mp3`;
    const { error: upErr } = await admin.storage
      .from("sermon-comments-audio")
      .upload(path, audioBuf, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw upErr;

    // Create signed URL (1 year)
    const { data: signed, error: signErr } = await admin.storage
      .from("sermon-comments-audio")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signErr || !signed?.signedUrl) throw signErr || new Error("sign failed");

    // Update comment row
    const { error: updErr } = await admin
      .from("sermon_comments")
      .update({ audio_url: signed.signedUrl })
      .eq("id", commentId);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ ok: true, audio_url: signed.signedUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tts-clone-comment error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 200, // soft fail so frontend keeps queue going
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});