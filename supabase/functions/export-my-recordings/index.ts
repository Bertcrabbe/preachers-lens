import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "no auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Get all the user's recorded comments (storage paths only — exclude AI Coach's
    // ElevenLabs-generated full-URL audio).
    const { data: comments, error: cErr } = await admin
      .from("sermon_comments")
      .select("audio_url, created_at")
      .eq("user_id", user.id)
      .not("audio_url", "is", null)
      .order("created_at", { ascending: true });
    if (cErr) throw cErr;

    const paths = (comments || [])
      .map((c) => c.audio_url as string)
      .filter((u) => u && !/^https?:\/\//i.test(u));

    if (paths.length === 0) {
      return new Response(JSON.stringify({ error: "No recorded comments found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sign each path so the client can download directly from Storage.
    const urls: string[] = [];
    for (const p of paths) {
      const { data: signed } = await admin.storage
        .from("sermon-comments-audio")
        .createSignedUrl(p, 60 * 60); // 1h
      if (signed?.signedUrl) urls.push(signed.signedUrl);
    }

    return new Response(JSON.stringify({ urls, count: urls.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("export-my-recordings error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});