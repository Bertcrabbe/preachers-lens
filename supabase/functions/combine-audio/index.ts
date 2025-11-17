import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to run FFmpeg commands
async function runFFmpeg(args: string[]): Promise<Uint8Array> {
  const command = new Deno.Command("ffmpeg", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();
  const { stdout, stderr } = await process.output();
  
  const status = await process.status;
  if (!status.success) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`FFmpeg failed: ${errorText}`);
  }

  return stdout;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Fetching sermon details for:", sermonId);

    // Fetch sermon details
    const { data: sermon, error: sermonError } = await supabase
      .from("sermons")
      .select("file_url, duration_seconds, user_id, title")
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

    console.log(`Found ${comments.length} audio comments to insert`);

    // Download original sermon audio
    const { data: sermonAudioBlob, error: sermonDownloadError } = await supabase
      .storage
      .from("sermons")
      .download(sermon.file_url);

    if (sermonDownloadError || !sermonAudioBlob) {
      throw new Error("Failed to download sermon audio");
    }

    // Save sermon audio to temp file
    const sermonPath = `/tmp/sermon_${crypto.randomUUID()}.m4a`;
    await Deno.writeFile(sermonPath, new Uint8Array(await sermonAudioBlob.arrayBuffer()));

    // Download all comment audio files
    const commentPaths: { path: string; timestamp: number }[] = [];
    for (const comment of comments) {
      const { data: commentBlob, error: commentError } = await supabase
        .storage
        .from("sermon-comments-audio")
        .download(comment.audio_url!);

      if (commentError || !commentBlob) {
        console.error(`Failed to download comment audio: ${comment.audio_url}`);
        continue;
      }

      const commentPath = `/tmp/comment_${crypto.randomUUID()}.webm`;
      await Deno.writeFile(commentPath, new Uint8Array(await commentBlob.arrayBuffer()));
      commentPaths.push({ path: commentPath, timestamp: comment.start_time_ms });
    }

    console.log("Building FFmpeg filter chain...");

    // Build FFmpeg filter complex for inserting audio at timestamps
    let filterComplex = `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[main];`;
    
    for (let i = 0; i < commentPaths.length; i++) {
      filterComplex += `[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${commentPaths[i].timestamp}|${commentPaths[i].timestamp}[c${i}];`;
    }

    // Mix all streams together
    const inputs = ["main", ...commentPaths.map((_, i) => `c${i}`)];
    filterComplex += `${inputs.map(i => `[${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest[out]`;

    // Build FFmpeg command
    const ffmpegArgs = [
      "-i", sermonPath,
      ...commentPaths.flatMap(c => ["-i", c.path]),
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-c:a", "libmp3lame",
      "-b:a", "192k",
      "-f", "mp3",
      "pipe:1"
    ];

    console.log("Running FFmpeg...");
    const combinedAudio = await runFFmpeg(ffmpegArgs);

    // Clean up temp files
    await Deno.remove(sermonPath);
    for (const comment of commentPaths) {
      await Deno.remove(comment.path);
    }

    // Upload combined audio
    const exportId = crypto.randomUUID();
    const fileName = `${sermon.title || 'sermon'}_combined_${exportId}.mp3`;
    const exportPath = `${sermon.user_id}/${fileName}`;

    console.log("Uploading combined audio...");
    
    const { error: uploadError } = await supabase.storage
      .from("sermon-exports")
      .upload(exportPath, combinedAudio, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload combined audio: ${uploadError.message}`);
    }

    // Generate public URL
    const { data: urlData } = await supabase.storage
      .from("sermon-exports")
      .createSignedUrl(exportPath, 604800); // 7 days

    console.log("Audio combination complete!");

    return new Response(
      JSON.stringify({
        success: true,
        audioUrl: urlData?.signedUrl,
        fileName,
        exportId,
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
