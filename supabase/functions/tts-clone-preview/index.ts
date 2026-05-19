import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "no auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, voiceId: voiceIdOverride } = await req.json();
    if (!text || typeof text !== "string") throw new Error("text required");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    const textToSpeak = text.replace(/^\s*\[AI Coach\]\s*(\([^)]*\)\s*)?/i, "").trim();
    if (!textToSpeak) throw new Error("Empty text");

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
      if (r.ok) { ttsResp = r; break; }
      lastErrText = await r.text();
      const isRate = r.status === 429 || /concurrent|rate_limit/i.test(lastErrText);
      console.error(`ElevenLabs preview attempt ${attempt + 1} failed`, r.status, lastErrText.slice(0, 200));
      if (!isRate || attempt === maxAttempts - 1) {
        throw new Error(`ElevenLabs ${r.status}: ${lastErrText.slice(0, 200)}`);
      }
      const delay = 1200 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
      await new Promise((res) => setTimeout(res, delay));
    }
    if (!ttsResp) throw new Error(`ElevenLabs failed after retries: ${lastErrText.slice(0, 200)}`);

    const audioBuf = await ttsResp.arrayBuffer();
    const audioBase64 = base64Encode(new Uint8Array(audioBuf));

    return new Response(JSON.stringify({ ok: true, audioContent: audioBase64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tts-clone-preview error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});