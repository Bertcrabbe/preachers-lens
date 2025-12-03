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
    const { sermonId, analyticsData, scriptureRefs } = await req.json();
    
    if (!sermonId) {
      throw new Error("Sermon ID is required");
    }

    console.log("Generating report for sermon:", sermonId);

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

    // Get comments with rules
    const { data: comments, error: commentsError } = await supabaseClient
      .from("sermon_comments")
      .select(`
        *,
        evaluation_rules (
          id,
          name,
          description,
          color
        )
      `)
      .eq("sermon_id", sermonId)
      .order("start_time_ms");

    if (commentsError) throw commentsError;

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

    const formatDuration = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Build the report content
    let content = "";
    
    // Title and metadata
    content += `${"═".repeat(60)}\n`;
    content += `SERMON ANALYSIS REPORT\n`;
    content += `${"═".repeat(60)}\n\n`;
    content += `Title: ${sermon.title || "Untitled Sermon"}\n`;
    content += `Date: ${new Date(sermon.created_at).toLocaleDateString()}\n`;
    if (sermon.duration_seconds) {
      content += `Duration: ${formatDuration(sermon.duration_seconds)}\n`;
    }
    content += `\n`;

    // Scripture References Section
    content += `${"─".repeat(60)}\n`;
    content += `SCRIPTURE REFERENCES\n`;
    content += `${"─".repeat(60)}\n\n`;
    
    if (scriptureRefs?.references && scriptureRefs.references.length > 0) {
      content += `Total References: ${scriptureRefs.total_count}\n\n`;
      scriptureRefs.references.forEach((ref: { reference: string; context: string }, idx: number) => {
        content += `${idx + 1}. ${ref.reference}\n`;
        content += `   Context: ${ref.context}\n\n`;
      });
    } else {
      content += `No scripture references identified.\n\n`;
    }

    // Analytics Section
    content += `${"─".repeat(60)}\n`;
    content += `SERMON ANALYTICS\n`;
    content += `${"─".repeat(60)}\n\n`;

    if (analyticsData) {
      content += `Average Words Per Minute: ${analyticsData.averageWPM || 'N/A'}\n`;
      content += `Fast Speech Sections (>${analyticsData.fastSpeechThreshold || 1.2}x avg): ${analyticsData.fastSpeechCount || 0}\n`;
      content += `Slow Speech Sections (<${analyticsData.slowSpeechThreshold || 0.75}x avg): ${analyticsData.slowSpeechCount || 0}\n`;
      content += `Verbal Pauses Detected: ${analyticsData.verbalPausesCount || 0}\n`;
      content += `Insider Language Instances: ${analyticsData.insiderLanguageCount || 0}\n\n`;

      if (analyticsData.topFillerWords && analyticsData.topFillerWords.length > 0) {
        content += `Top Filler Words:\n`;
        analyticsData.topFillerWords.forEach((fw: { word: string; count: number }) => {
          content += `  • "${fw.word}" - ${fw.count} times\n`;
        });
        content += `\n`;
      }

      if (analyticsData.topInsiderTerms && analyticsData.topInsiderTerms.length > 0) {
        content += `Top Insider Terms:\n`;
        analyticsData.topInsiderTerms.forEach((term: { word: string; count: number }) => {
          content += `  • "${term.word}" - ${term.count} times\n`;
        });
        content += `\n`;
      }
    }

    // AI-Generated Comments Section
    content += `${"─".repeat(60)}\n`;
    content += `AI-GENERATED EVALUATION COMMENTS\n`;
    content += `${"─".repeat(60)}\n\n`;

    const aiComments = comments?.filter((c: any) => c.rule_id && c.evaluation_rules) || [];
    
    if (aiComments.length > 0) {
      // Group comments by rule
      const commentsByRule: { [key: string]: any[] } = {};
      aiComments.forEach((comment: any) => {
        const ruleName = comment.evaluation_rules?.name || "Unknown Rule";
        if (!commentsByRule[ruleName]) {
          commentsByRule[ruleName] = [];
        }
        commentsByRule[ruleName].push(comment);
      });

      for (const [ruleName, ruleComments] of Object.entries(commentsByRule)) {
        content += `► ${ruleName} (${ruleComments.length} comments)\n`;
        content += `${"·".repeat(40)}\n`;
        
        ruleComments.forEach((comment: any, idx: number) => {
          content += `\n  ${idx + 1}. [${formatTimestamp(comment.start_time_ms)}]\n`;
          content += `     ${comment.comment_text}\n`;
        });
        content += `\n`;
      }
    } else {
      content += `No AI-generated evaluation comments.\n\n`;
    }

    // Manual Comments Section
    const manualComments = comments?.filter((c: any) => !c.rule_id) || [];
    
    content += `${"─".repeat(60)}\n`;
    content += `MANUAL COMMENTS\n`;
    content += `${"─".repeat(60)}\n\n`;

    if (manualComments.length > 0) {
      manualComments.forEach((comment: any, idx: number) => {
        content += `${idx + 1}. [${formatTimestamp(comment.start_time_ms)}]\n`;
        content += `   ${comment.comment_text}\n`;
        if (comment.audio_url) {
          content += `   📎 Has audio commentary attached\n`;
        }
        content += `\n`;
      });
    } else {
      content += `No manual comments.\n\n`;
    }

    // Full Transcript Section
    content += `${"─".repeat(60)}\n`;
    content += `FULL TRANSCRIPT\n`;
    content += `${"─".repeat(60)}\n\n`;

    if (sentences && sentences.length > 0) {
      sentences.forEach((sentence: any) => {
        content += `[${formatTimestamp(sentence.start_time_ms)}] ${sentence.sentence_text}\n\n`;
      });
    }

    // Footer
    content += `\n${"═".repeat(60)}\n`;
    content += `Report generated on ${new Date().toLocaleString()}\n`;
    content += `${"═".repeat(60)}\n`;

    console.log("Report generated successfully, length:", content.length);

    return new Response(
      JSON.stringify({
        content,
        filename: `${sermon.title || "sermon"}-report.txt`,
        mimeType: "text/plain",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Report generation error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Report generation failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
