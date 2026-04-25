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
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch all sentences
    let allSentences: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/sermon_sentences?sermon_id=eq.${sermonId}&order=order_index.asc&offset=${from}&limit=${pageSize}`,
        { headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` } }
      );
      if (!res.ok) break;
      const data = await res.json();
      if (!data || data.length === 0) break;
      allSentences.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    if (allSentences.length === 0) {
      return new Response(JSON.stringify({ know: "", feel: "", do: "", summary: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build transcript, capped to ~40k chars to stay within limits
    const fullText = allSentences.map((s) => s.sentence_text).join(" ");
    const transcript = fullText.length > 40000
      ? fullText.slice(0, 20000) + "\n\n[...middle truncated...]\n\n" + fullText.slice(-15000)
      : fullText;

    const models = ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "google/gemini-2.5-flash-lite"];
    let lastError = "";

    for (const model of models) {
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `You are a homiletics coach. Every sermon should answer three questions about the preacher's intent:
1. KNOW — What truth, idea, or doctrine does the preacher want listeners to understand?
2. FEEL — What emotional response does the preacher want to evoke?
3. DO — What concrete action or response does the preacher want listeners to take?

Read the sermon transcript and infer the preacher's likely answers to each. Answer directly and concisely in one sentence each — do NOT use framing like "the preacher wants listeners to..." or "listeners should understand that..." Just state the substance plainly. Be specific and concrete — avoid vague generalities like "to grow in faith." If an answer is genuinely unclear or absent from the sermon, say so directly in one sentence (e.g., "Not clearly addressed — the sermon focuses on knowing without a specific action").

Also write a one-sentence summary of the sermon's overall thrust.`,
              },
              {
                role: "user",
                content: `Analyze this sermon transcript. Return ONLY valid JSON (no markdown):
{
  "know": "<one direct sentence stating what the preacher wants listeners to understand, without framing phrases>",
  "feel": "<one direct sentence stating the emotional response the preacher wants to evoke, without framing phrases>",
  "do": "<one direct sentence stating the concrete action the preacher wants listeners to take, without framing phrases>",
  "summary": "<one sentence summarizing the sermon's central thrust>"
}

Transcript:
${transcript}`,
              },
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

        return new Response(JSON.stringify({
          know: result.know ?? "",
          feel: result.feel ?? "",
          do: result.do ?? "",
          summary: result.summary ?? "",
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});