import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Fetch sermon sentences
    const sentencesResponse = await fetch(
      `${supabaseUrl}/rest/v1/sermon_sentences?sermon_id=eq.${sermonId}&order=order_index.asc`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
      }
    );

    if (!sentencesResponse.ok) {
      throw new Error("Failed to fetch sermon sentences");
    }

    const sentences = await sentencesResponse.json();
    
    // Build numbered transcript so AI can reference sentence indices
    const numberedTranscript = sentences.map((s: any, i: number) => `[${i}] ${s.sentence_text}`).join("\n");
    
    // Truncate to avoid exceeding AI context limits and reduce latency
    const maxChars = 30000;
    const transcript = numberedTranscript.length > maxChars 
      ? numberedTranscript.substring(0, maxChars) + "\n\n[TRANSCRIPT TRUNCATED]"
      : numberedTranscript;

    console.log(`Transcript length: ${numberedTranscript.length} chars, sending: ${transcript.length} chars`);

    // Use fastest models first to minimize response time
    const models = ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "openai/gpt-5-nano"];
    // Per-model timeout budget so we never exceed the 150s edge function limit
    const PER_MODEL_TIMEOUT_MS = 45000;
    let lastError = "";

    for (const model of models) {
      console.log(`Trying model: ${model}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: "You are a biblical scholar assistant. Identify all scripture references in the given text. Only count verses that are actually read, quoted, or directly referenced. Consecutive verses from the same book/chapter should be consolidated into ranges."
              },
              {
                role: "user",
                content: `Analyze this sermon transcript. Each sentence is numbered with [index]. Identify ALL scripture references. Rules:
1. Only count verses actually READ or QUOTED.
2. Consolidate consecutive verses into ranges (e.g., "Romans 1:29-31").
3. Count individual verses per reference.
4. For "scripture_sentence_indices", list ALL sentence indices [n] that contain or are part of scripture being read/quoted. This includes:
   - Sentences where the preacher is reading scripture aloud
   - Sentences that are direct quotes from the Bible (even if the preacher doesn't explicitly say the reference)
   - Questions that come from scripture (e.g., Jesus asking "Do you think I came to bring peace?")
   Be thorough - include EVERY sentence that is part of a scripture passage being read.

Respond with ONLY valid JSON (no markdown):
{"references": [{"reference": "Romans 6:1-4", "context": "brief quote", "verse_count": 4}], "total_count": 1, "total_verses": 4, "scripture_sentence_indices": [0, 1, 2, 3]}

Transcript:\n\n${transcript}`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`Model ${model} error:`, aiResponse.status, errorText);
          lastError = `${model}: ${aiResponse.status}`;
          clearTimeout(timeoutId);
          continue;
        }

        const aiResult = await aiResponse.json();
        const content = aiResult.choices[0].message.content;
        
        const jsonStr = content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const result = JSON.parse(jsonStr);
        
        // Ensure scripture_sentence_indices is always an array
        if (!result.scripture_sentence_indices) {
          result.scripture_sentence_indices = [];
        }
        
        console.log(`Found ${result.scripture_sentence_indices.length} scripture sentence indices`);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (modelError) {
        console.error(`Model ${model} failed:`, modelError);
        lastError = `${model}: ${modelError}`;
        continue;
      }
    }
    
    throw new Error(`All AI models failed. Last error: ${lastError}`);
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
