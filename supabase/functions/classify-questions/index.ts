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

    // Find all question sentences (ending with ?)
    const questionSentences = sentences
      .map((s: any, i: number) => ({ index: i, text: s.sentence_text }))
      .filter((s: any) => s.text.trim().endsWith('?'));

    if (questionSentences.length === 0) {
      return new Response(JSON.stringify({ congregation_indices: [], total_questions: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build context: include surrounding sentences for each question
    const questionsWithContext = questionSentences.map((q: any) => {
      const contextStart = Math.max(0, q.index - 2);
      const contextEnd = Math.min(sentences.length - 1, q.index + 1);
      const context = sentences.slice(contextStart, contextEnd + 1)
        .map((s: any) => s.sentence_text).join(" ");
      return `[${q.index}] "${q.text}" (context: ${context})`;
    }).join("\n");

    const models = ["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "openai/gpt-5-nano"];
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
                content: `You are a sermon analysis expert. Classify questions in a sermon transcript as either directed TO THE CONGREGATION or not.

Questions TO the congregation include:
- Direct engagement: "How many of you have...?", "Can I get an amen?"
- Rhetorical questions meant to make the audience reflect: "What would you do if...?", "Have you ever felt that way?"
- Invitations to respond: "Are you ready?", "Does that make sense?"
- Challenging questions directed at listeners: "Are you living that way?"

Questions NOT directed to the congregation include:
- Narrative/storytelling questions: "What did Jesus say next?", "And what happened?"
- Quoting scripture questions: "Do you think I came to bring peace?"
- Self-rhetorical questions the preacher answers themselves: "So what does Paul mean here?"
- Questions setting up a teaching point that the preacher immediately answers

Be precise. Only mark questions as "congregation" if they genuinely invite the audience to reflect, respond, or engage.`
              },
              {
                role: "user",
                content: `Classify each question below. Return ONLY valid JSON (no markdown):
{"congregation_indices": [list of sentence indices that are questions TO the congregation]}

Questions:
${questionsWithContext}`
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

        if (!result.congregation_indices) {
          result.congregation_indices = [];
        }

        console.log(`Classified ${result.congregation_indices.length} congregation questions out of ${questionSentences.length} total`);

        return new Response(JSON.stringify({
          congregation_indices: result.congregation_indices,
          total_questions: questionSentences.length,
        }), {
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
