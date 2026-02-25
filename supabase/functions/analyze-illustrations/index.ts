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
    const fullTranscript = sentences.map((s: any) => s.sentence_text).join(" ");

    const maxChars = 80000;
    const transcript = fullTranscript.length > maxChars
      ? fullTranscript.substring(0, maxChars) + "\n\n[TRANSCRIPT TRUNCATED]"
      : fullTranscript;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing sermons for engagement. Your job is to identify illustrations, stories, humor, analogies, and personal anecdotes in the transcript. These are the elements that make a sermon engaging and relatable.

Look for:
- Personal stories, anecdotes, or personal narratives ("I remember when...", "Last week I...")
- Illustrations or examples that explain abstract concepts
- Humor, jokes, or lighthearted moments
- Analogies or metaphors that connect ideas
- References to pop culture, current events, or everyday life
- Audience interaction moments ("raise your hand", "turn to your neighbor")

For each found element, classify it as: story, analogy, humor, illustration, or audience_interaction. Note: personal anecdotes should be classified as "story".`
          },
          {
            role: "user",
            content: `Analyze this sermon transcript and identify all illustrations, stories, humor, analogies, and engaging elements.

${transcript}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_illustrations",
              description: "Return all illustrations and engaging elements found in the sermon",
              parameters: {
                type: "object",
                properties: {
                  elements: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["story", "analogy", "humor", "illustration", "audience_interaction"], description: "Type of engaging element" },
                        summary: { type: "string", description: "Brief summary of the element (1-2 sentences)" },
                        excerpt: { type: "string", description: "A short excerpt from the transcript showing this element" },
                      },
                      required: ["type", "summary", "excerpt"]
                    }
                  },
                  total_count: { type: "number", description: "Total number of engaging elements found" },
                  illustration_score: { type: "number", description: "Score from 1-10 where 10 means the sermon is full of engaging illustrations and stories" },
                  breakdown: {
                    type: "object",
                    properties: {
                      stories: { type: "number" },
                      analogies: { type: "number" },
                      humor: { type: "number" },
                      illustrations: { type: "number" },
                      audience_interactions: { type: "number" },
                    },
                    required: ["stories", "analogies", "humor", "illustrations", "audience_interactions"]
                  }
                },
                required: ["elements", "total_count", "illustration_score", "breakdown"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "report_illustrations" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errorText);
      throw new Error("Failed to analyze illustrations");
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices[0].message.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
