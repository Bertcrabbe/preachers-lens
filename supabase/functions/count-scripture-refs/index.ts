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

    // Call Lovable AI to identify scripture references
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a biblical scholar assistant. Identify all scripture references in the given text. IMPORTANT: Only count verses that are actually read, quoted, or directly referenced with specific verse numbers. If a speaker mentions a book and chapter (e.g., 'Luke 12') but only reads or quotes specific verses from it, only count those specific verses — do NOT count the entire chapter. Consecutive verses from the same book/chapter that are read back-to-back should be consolidated into a single reference range."
          },
          {
            role: "user",
            content: `Please analyze this sermon transcript and identify ALL scripture references (books, chapters, verses). IMPORTANT RULES:
1. ONLY count verses that are actually READ, QUOTED, or PARAPHRASED in the sermon. If a speaker says "turn to Luke 12" but only reads verses 15-21, the reference should be "Luke 12:15-21" (7 verses), NOT "Luke 12" (entire chapter).
2. If a chapter is mentioned by name but no specific verses are read from it, list it as a general reference with verse_count of 0.
3. Consolidate consecutive verses into ranges - if verses 29, 30, and 31 from the same chapter are mentioned together, count it as ONE reference (e.g., "Romans 1:29-31").
4. Only count distinct, separate scripture passages as individual references.
5. For each reference, count ONLY the number of verses actually read/quoted (e.g., "Romans 6:1-4" = 4 verses, "John 3:16" = 1 verse).
6. Provide a total_verses count summing all individual verses across all references.

Format each reference as a citation (e.g., "Romans 6:1-4") with brief context showing how it was referenced.

Here's the transcript:\n\n${fullTranscript}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "list_scripture_references",
              description: "Return a list of all unique scripture references found in the sermon",
              parameters: {
                type: "object",
                properties: {
                  references: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        reference: { type: "string", description: "The scripture citation (e.g., 'Romans 6:1-4')" },
                        context: { type: "string", description: "Brief quote showing how it was referenced" },
                        verse_count: { type: "number", description: "Number of individual verses covered by this reference (e.g., Romans 6:1-4 = 4 verses, John 3:16 = 1 verse)" }
                      },
                      required: ["reference", "context", "verse_count"]
                    }
                  },
                  total_count: { type: "number", description: "Total number of unique scripture references" },
                  total_verses: { type: "number", description: "Total number of individual verses across all references" }
                },
                required: ["references", "total_count", "total_verses"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "list_scripture_references" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error("Failed to analyze scripture references");
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
