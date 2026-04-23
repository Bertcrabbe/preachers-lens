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

    // Fetch sermon sentences (paginated)
    const allSentences: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/sermon_sentences?sermon_id=eq.${sermonId}&order=order_index.asc&offset=${from}&limit=${pageSize}`,
        {
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
        }
      );
      if (!res.ok) break;
      const data = await res.json();
      if (!data || data.length === 0) break;
      allSentences.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    if (allSentences.length === 0) {
      throw new Error("No sermon sentences found");
    }

    const fullTranscript = allSentences.map((s: any) => s.sentence_text).join(" ");
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
            content: `You are an expert at analyzing the EMOTIONAL RESONANCE of sermons — the degree to which a sermon engages the heart, not just the head. Many young preachers are long on intellect and short on heart; this analysis identifies how well a sermon actually moves the listener.

Evaluate FIVE dimensions on a 1-10 scale (1 = absent, 10 = abundant and skillful):

1. VULNERABILITY — Personal self-disclosure. Does the preacher share their own struggles, fears, failures, doubts, longings? Phrases like "I remember when…", "I was afraid…", "I wept…", "I struggled with…" indicate this. Generic illustrations about other people DO NOT count.

2. AFFECTIVE LANGUAGE — Density of emotional vocabulary: love, grief, ache, longing, joy, wonder, broken, healed, tender, lost, found, weep, rejoice, fear, hope, mercy, tenderness. Score the saturation of feeling-words throughout, not just one or two moments.

3. SENSORY & CONCRETE IMAGERY — Specific, vivid, sensory detail vs. abstract conceptual language. "The smell of my grandfather's hospital room" (high) vs. "the reality of human mortality" (low). Show vs. tell.

4. PATHOS MOMENTS — Identify specific moments in the sermon engineered to stir emotion. Each moment has a type: lament, awe, tenderness, conviction, hope, longing, grief, or wonder. Quality matters more than quantity. Score the cumulative power of these moments.

5. HEAD/HEART RATIO — Estimate the percentage of paragraphs that are primarily AFFECTIVE (felt, imagined, longed for, invited) vs. COGNITIVE (explained, defined, argued). A pure-heady sermon is 10-15% affective; a balanced sermon ~30-40%; a heart-heavy sermon 50%+. Report the affective percentage as a number 0-100.

OVERALL SCORE (1-10): Weighted holistic judgment of how well this sermon will TOUCH the listener's heart, not just inform their mind. Be honest — most intellectually-strong young preachers will score 4-6. A score of 8+ is reserved for sermons that genuinely move the heart.

Also extract 3-8 specific PATHOS MOMENTS with short excerpts.`
          },
          {
            role: "user",
            content: `Analyze the emotional resonance of this sermon transcript:\n\n${transcript}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_emotional_resonance",
              description: "Return the emotional resonance analysis of the sermon",
              parameters: {
                type: "object",
                properties: {
                  overall_score: { type: "number", description: "Overall emotional resonance score 1-10" },
                  subscores: {
                    type: "object",
                    properties: {
                      vulnerability: { type: "number", description: "1-10" },
                      affective_language: { type: "number", description: "1-10" },
                      sensory_imagery: { type: "number", description: "1-10" },
                      pathos_moments: { type: "number", description: "1-10" },
                    },
                    required: ["vulnerability", "affective_language", "sensory_imagery", "pathos_moments"]
                  },
                  affective_percentage: { type: "number", description: "Percentage of sermon that is primarily affective vs cognitive (0-100)" },
                  summary: { type: "string", description: "1-3 sentence honest assessment of the sermon's heart/emotional resonance and what would strengthen it" },
                  pathos_moments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["lament", "awe", "tenderness", "conviction", "hope", "longing", "grief", "wonder"] },
                        excerpt: { type: "string", description: "A short excerpt (1-3 sentences) from the transcript" },
                        note: { type: "string", description: "Brief note on why this is emotionally resonant" },
                      },
                      required: ["type", "excerpt", "note"]
                    }
                  }
                },
                required: ["overall_score", "subscores", "affective_percentage", "summary", "pathos_moments"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "report_emotional_resonance" } }
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
      throw new Error("Failed to analyze emotional resonance");
    }

    const aiResult = await aiResponse.json();
    const toolCall = aiResult.choices[0].message.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

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