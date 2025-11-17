import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId, format } = await req.json();
    if (!sermonId || !format) {
      throw new Error("Sermon ID and format are required");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get sermon details
    const { data: sermon, error: sermonError } = await supabaseClient
      .from("sermons")
      .select("*")
      .eq("id", sermonId)
      .single();

    if (sermonError) throw sermonError;

    // Get sentences
    const { data: sentences, error: sentencesError } = await supabaseClient
      .from("sermon_sentences")
      .select("*")
      .eq("sermon_id", sermonId)
      .order("order_index");

    if (sentencesError) throw sentencesError;

    const formatTimestamp = (ms: number): string => {
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
          .toString()
          .padStart(2, "0")}`;
      }
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    let content = "";
    let contentType = "text/plain";

    switch (format) {
      case "txt":
        content = `${sermon.title || "Untitled Sermon"}\n`;
        content += `Uploaded: ${new Date(sermon.created_at).toLocaleDateString()}\n`;
        if (sermon.duration_seconds) {
          content += `Duration: ${Math.floor(sermon.duration_seconds / 60)}:${(
            sermon.duration_seconds % 60
          )
            .toString()
            .padStart(2, "0")}\n`;
        }
        content += `\n${"=".repeat(50)}\n\n`;

        for (const sentence of sentences) {
          content += `[${formatTimestamp(sentence.start_time_ms)}] ${sentence.sentence_text}\n\n`;
        }
        break;

      case "md":
        content = `# ${sermon.title || "Untitled Sermon"}\n\n`;
        content += `**Uploaded:** ${new Date(sermon.created_at).toLocaleDateString()}\n`;
        if (sermon.duration_seconds) {
          content += `**Duration:** ${Math.floor(sermon.duration_seconds / 60)}:${(
            sermon.duration_seconds % 60
          )
            .toString()
            .padStart(2, "0")}\n`;
        }
        content += `\n---\n\n## Transcript\n\n`;

        for (const sentence of sentences) {
          content += `**[${formatTimestamp(sentence.start_time_ms)}]** ${sentence.sentence_text}\n\n`;
        }
        break;

      case "pdf":
      case "docx":
        // For PDF and DOCX, we'll return a formatted text for now
        // In production, you'd want to use a library like jsPDF or docx
        content = `${sermon.title || "Untitled Sermon"}\n`;
        content += `Uploaded: ${new Date(sermon.created_at).toLocaleDateString()}\n`;
        if (sermon.duration_seconds) {
          content += `Duration: ${Math.floor(sermon.duration_seconds / 60)}:${(
            sermon.duration_seconds % 60
          )
            .toString()
            .padStart(2, "0")}\n`;
        }
        content += `\n${"=".repeat(50)}\n\nTranscript\n\n`;

        for (const sentence of sentences) {
          content += `[${formatTimestamp(sentence.start_time_ms)}] ${sentence.sentence_text}\n\n`;
        }
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    return new Response(content, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${sermon.title || "sermon"}.${format}"`,
      },
    });
  } catch (error: any) {
    console.error("Export error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Export failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
