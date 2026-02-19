import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const fullTranscript = sentences.map((s: any) => s.sentence_text).join(" ");
    
    // Truncate to avoid exceeding AI context limits
    const maxChars = 80000;
    const transcript = fullTranscript.length > maxChars 
      ? fullTranscript.substring(0, maxChars) + "\n\n[TRANSCRIPT TRUNCATED]"
      : fullTranscript;

    console.log(`Transcript length: ${fullTranscript.length} chars, sending: ${transcript.length} chars`);

    // Try multiple models in case one is unavailable
    const models = ["openai/gpt-5-nano", "google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
    let lastError = "";
    
    for (const model of models) {
      console.log(`Trying model: ${model}`);
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
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
                content: `Analyze this sermon transcript and identify ALL scripture references. Rules:
1. Only count verses actually READ or QUOTED.
2. Consolidate consecutive verses into ranges (e.g., "Romans 1:29-31").
3. Count individual verses per reference.

Respond with ONLY valid JSON (no markdown):
{"references": [{"reference": "Romans 6:1-4", "context": "brief quote", "verse_count": 4}], "total_count": 1, "total_verses": 4}

Transcript:\n\n${transcript}`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`Model ${model} error:`, aiResponse.status, errorText);
          lastError = `${model}: ${aiResponse.status}`;
          continue;
        }

        const aiResult = await aiResponse.json();
        const content = aiResult.choices[0].message.content;
        
        const jsonStr = content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const result = JSON.parse(jsonStr);

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
