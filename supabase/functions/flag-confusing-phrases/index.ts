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
    
    // Build transcript with sentence indices for mapping back
    const indexedTranscript = sentences.map((s: any, i: number) => 
      `[${i}] ${s.sentence_text}`
    ).join("\n");

    // Call Lovable AI to identify confusing phrases
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
            content: `You are an expert at evaluating sermons for accessibility to first-time church visitors. Your job is to identify specific phrases, sentences, or concepts that would confuse someone who has never been to church before.

Look for:
- Theological jargon used without explanation (e.g., "justification", "sanctification", "the blood")
- Assumed knowledge of Bible stories, characters, or church traditions
- Inside references to church programs, events, or culture (e.g., "small groups", "altar call", "worship night")
- Phrases that sound strange or alienating to outsiders (e.g., "washed in the blood", "on fire for God")
- References to denominations, theological positions, or church governance without context
- Assumptions about shared beliefs or experiences ("we all know that...", "as Christians we...")
- Cultural shorthand that only regular churchgoers would understand

Do NOT flag:
- The name "Jesus" on its own — it is universally understood and should never be flagged
- Common English words or phrases that happen to have religious origins
- Simple, self-explanatory references to God, prayer, or the Bible
- Phrases where the speaker already explains what they mean in context

Special rule for biblical names:
- Other biblical figure names used on their own (e.g., "Paul", "Apostle Paul", "Moses", "Abraham", "David", "Elijah", "Isaiah") should be flagged as "mild" severity since a newcomer may not know who they are, but they are not deeply confusing

Severity guidelines:
- "mild": standalone biblical names, simple church terms like "small groups"
- "moderate": theological terms that can be briefly explained (e.g., "grace", "redemption")
- "severe": dense theological language, loaded doctrinal phrases, direct invocations or prayers to the Holy Spirit (e.g., "Holy Spirit, come and invade our hearts"), Trinitarian address patterns, or multi-concept constructs that require significant background knowledge (e.g., "royal priesthood", "holy nation", "washed in the blood", "justification by faith", "propitiation"). If a phrase packs multiple unfamiliar theological concepts together, or addresses a member of the Trinity directly in prayer/invocation, it is severe.`
          },
          {
            role: "user",
            content: `Analyze this sermon transcript and identify phrases or sentences that would confuse a first-time church visitor. Each sentence is prefixed with its index number in brackets.

${indexedTranscript}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "flag_confusing_phrases",
              description: "Return a list of confusing phrases found in the sermon",
              parameters: {
                type: "object",
                properties: {
                  phrases: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        sentence_index: { type: "number", description: "The index of the sentence containing the confusing phrase" },
                        phrase: { type: "string", description: "The specific confusing phrase or term" },
                        reason: { type: "string", description: "Brief explanation of why this would confuse a first-time visitor" },
                        suggestion: { type: "string", description: "How the speaker could rephrase or explain this for clarity" },
                        severity: { type: "string", enum: ["mild", "moderate", "severe"], description: "How confusing this would be: mild = slightly unclear, moderate = likely confusing, severe = very alienating" }
                      },
                      required: ["sentence_index", "phrase", "reason", "suggestion", "severity"]
                    }
                  },
                  total_count: { type: "number", description: "Total number of confusing phrases found" },
                  accessibility_score: { type: "number", description: "Score from 1-10 where 10 is perfectly accessible to newcomers" }
                },
                required: ["phrases", "total_count", "accessibility_score"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "flag_confusing_phrases" } }
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
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error("Failed to analyze confusing phrases");
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices[0].message.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const result = JSON.parse(toolCall.function.arguments);

    // Enrich phrases with timestamp data from sentences
    const enrichedPhrases = result.phrases.map((p: any) => {
      const sentence = sentences[p.sentence_index];
      if (sentence) {
        return {
          ...p,
          start_time_ms: sentence.start_time_ms,
          end_time_ms: sentence.end_time_ms,
          sentence_text: sentence.sentence_text,
        };
      }
      return p;
    }).filter((p: any) => p.start_time_ms != null);

    return new Response(JSON.stringify({
      phrases: enrichedPhrases,
      total_count: enrichedPhrases.length,
      accessibility_score: result.accessibility_score,
    }), {
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
