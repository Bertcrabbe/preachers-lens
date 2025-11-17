import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch sermon details
    const { data: sermon, error: sermonError } = await supabase
      .from("sermons")
      .select("file_url, duration_seconds, user_id")
      .eq("id", sermonId)
      .single();

    if (sermonError || !sermon) {
      throw new Error("Sermon not found");
    }

    // Fetch audio comments ordered by timestamp
    const { data: comments, error: commentsError } = await supabase
      .from("sermon_comments")
      .select("start_time_ms, audio_url")
      .eq("sermon_id", sermonId)
      .not("audio_url", "is", null)
      .order("start_time_ms");

    if (commentsError) {
      throw new Error("Failed to fetch comments");
    }

    if (!comments || comments.length === 0) {
      throw new Error("No audio comments found");
    }

    // Download original sermon audio
    const { data: sermonAudioData, error: sermonDownloadError } = await supabase
      .storage
      .from("sermons")
      .download(sermon.file_url);

    if (sermonDownloadError) {
      throw new Error("Failed to download sermon audio");
    }

    // For this implementation, we'll create a simple manifest file
    // In production, you'd want to use FFmpeg or similar to actually combine the audio
    // For now, we'll create a JSON manifest that describes the audio segments
    const manifest = {
      originalAudio: sermon.file_url,
      duration: sermon.duration_seconds,
      insertions: comments.map(c => ({
        timestamp: c.start_time_ms,
        audioUrl: c.audio_url
      }))
    };

    // Generate a unique filename
    const exportId = crypto.randomUUID();
    const manifestPath = `${sermon.user_id}/${exportId}-manifest.json`;
    
    // Upload manifest to storage
    const { error: uploadError } = await supabase.storage
      .from("sermon-exports")
      .upload(manifestPath, JSON.stringify(manifest), {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) {
      throw new Error("Failed to upload export manifest");
    }

    // Generate a public URL for the manifest
    const { data: urlData } = await supabase.storage
      .from("sermon-exports")
      .createSignedUrl(manifestPath, 604800); // 7 days

    return new Response(
      JSON.stringify({
        success: true,
        manifestUrl: urlData?.signedUrl,
        exportId,
        message: "Audio combination manifest created. Note: Full audio merging requires server-side processing with FFmpeg."
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error combining audio:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
