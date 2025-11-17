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
    const { sermonId } = await req.json();
    if (!sermonId) {
      throw new Error("Sermon ID is required");
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

    // Update status to processing
    await supabaseClient
      .from("sermons")
      .update({ transcription_status: "processing" })
      .eq("id", sermonId);

    // Get signed URL for the audio file
    const { data: urlData, error: urlError } = await supabaseClient.storage
      .from("sermons")
      .createSignedUrl(sermon.file_url, 3600);

    if (urlError) throw urlError;

    // Submit to AssemblyAI
    const assemblyAIKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyAIKey) throw new Error("AssemblyAI API key not configured");

    // Upload file to AssemblyAI
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        "Authorization": assemblyAIKey,
      },
      body: await fetch(urlData.signedUrl).then((r) => r.blob()),
    });

    const { upload_url } = await uploadResponse.json();

    // Submit transcription job
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        "Authorization": assemblyAIKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: upload_url,
        sentiment_analysis: false,
        auto_highlights: false,
        summarization: false,
      }),
    });

    const transcript = await transcriptResponse.json();

    // Poll for completion
    let status = "processing";
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max

    while (status === "processing" || status === "queued") {
      if (attempts >= maxAttempts) {
        throw new Error("Transcription timeout");
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(
        `https://api.assemblyai.com/v2/transcript/${transcript.id}`,
        {
          headers: {
            "Authorization": assemblyAIKey,
          },
        }
      );

      const statusData = await statusResponse.json();
      status = statusData.status;

      if (status === "completed") {
        // Extract sentences from the transcript
        const sentences = statusData.words || [];
        const groupedSentences: Array<{
          text: string;
          start: number;
          end: number;
        }> = [];

        let currentSentence = "";
        let sentenceStart = 0;
        let sentenceEnd = 0;

        for (let i = 0; i < sentences.length; i++) {
          const word = sentences[i];
          if (i === 0) {
            sentenceStart = word.start;
          }

          currentSentence += word.text + " ";
          sentenceEnd = word.end;

          // Check if sentence ends
          const endsWithPunctuation = /[.!?]$/.test(word.text);
          const isLastWord = i === sentences.length - 1;

          if (endsWithPunctuation || isLastWord) {
            groupedSentences.push({
              text: currentSentence.trim(),
              start: sentenceStart,
              end: sentenceEnd,
            });
            currentSentence = "";
          }
        }

        // Store sentences in database
        const sentenceRecords = groupedSentences.map((sentence, index) => ({
          sermon_id: sermonId,
          start_time_ms: sentence.start,
          end_time_ms: sentence.end,
          sentence_text: sentence.text,
          order_index: index,
        }));

        await supabaseClient.from("sermon_sentences").insert(sentenceRecords);

        // Update sermon status and duration
        await supabaseClient
          .from("sermons")
          .update({
            transcription_status: "completed",
            duration_seconds: Math.round(statusData.audio_duration),
          })
          .eq("id", sermonId);

        return new Response(
          JSON.stringify({ success: true, sentenceCount: groupedSentences.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (status === "error") {
        throw new Error(statusData.error || "Transcription failed");
      }

      attempts++;
    }

    throw new Error("Unexpected transcription status");
  } catch (error: any) {
    console.error("Transcription error:", error);
    
    // Update sermon status to failed
    const errorSermonId = error?.sermonId;
    if (errorSermonId) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      
      await supabaseClient
        .from("sermons")
        .update({
          transcription_status: "failed",
          error_message: error?.message || "Transcription failed",
        })
        .eq("id", errorSermonId);
    }

    return new Response(
      JSON.stringify({ error: error?.message || "Transcription failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
