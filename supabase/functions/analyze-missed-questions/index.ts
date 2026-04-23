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

    // Fetch all sentences with pagination
    let allSentences: any[] = [];
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
      return new Response(JSON.stringify({ opportunities: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-filter: only consider declarative sentences (not already questions)
    // that contain emotional/experiential language likely to be more impactful as questions.
    const candidateKeywords = /\b(many of us|some of us|all of us|we all|we've all|we have all|you've|you have|we know|we feel|we've felt|we have felt|i know what it|you know what it|there are times|there comes a time|it hurts|it's painful|the pain of|the joy of|the fear of|the shame of|the loneliness of|have you ever|have known|has known|felt the|felt that|been there|carry the|carrying|wrestle with|struggle with|struggling with)\b/i;

    const candidates = allSentences
      .map((s: any, i: number) => ({ index: i, text: s.sentence_text }))
      .filter((s) => {
        const t = s.text.trim();
        if (t.endsWith('?')) return false;
        if (t.length < 25) return false;
        return candidateKeywords.test(t);
      });

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ opportunities: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap to keep prompt small
    const capped = candidates.slice(0, 80);
    const candidateBlock = capped
      .map((c) => `[${c.index}] ${c.text}`)
      .join("\n");

    const models = ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "google/gemini-2.5-flash-lite"];
    let lastError = "";

    for (const model of models) {
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
                content: `You are a homiletics coach analyzing a sermon for emotional engagement.

Your job: identify declarative statements where the preacher TELLS the congregation about a shared emotional experience, when REPHRASING AS A DIRECT QUESTION would create dramatically more emotional impact and self-reflection.

Classic example:
- Statement (less impactful): "Many of us have known the pain of divorce."
- Question (more impactful): "Do you know what it feels like to walk through a divorce?"

Statements TO FLAG:
- Generalizations about shared pain, struggle, fear, joy, loneliness, shame, doubt
- "Many of us…", "We've all…", "You've felt…", "There are times…" patterns
- Statements describing an emotional experience the listener could be invited to own personally

Do NOT flag:
- Theological claims, doctrinal statements, scriptural quotes
- Narrative/storytelling about Bible characters or other people
- Practical instructions or applications
- Statements where a question would feel forced or rhetorical filler
- Statements that are merely informational

Be balanced — flag clear cases AND reasonable opportunities, but skip weak ones. Aim for high signal.

For each flagged statement, write a SHORT (under 15 words) suggested question rewrite that preserves the meaning but invites the listener to self-reflect.`,
              },
              {
                role: "user",
                content: `Analyze these candidate statements from a sermon. Return ONLY valid JSON (no markdown):
{"opportunities": [{"index": <sentence_index>, "statement": "<original text>", "suggested_question": "<rewrite as a direct question>", "reason": "<one short sentence on why a question would land harder>"}]}

Only include statements that genuinely would be more impactful as a question. If none qualify, return {"opportunities": []}.

Candidates:
${candidateBlock}`,
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

        if (!Array.isArray(result.opportunities)) {
          result.opportunities = [];
        }

        // Validate indices reference real sentences
        const validOpps = result.opportunities.filter((o: any) =>
          typeof o.index === "number" &&
          o.index >= 0 &&
          o.index < allSentences.length &&
          typeof o.suggested_question === "string" &&
          o.suggested_question.trim().length > 0
        );

        console.log(`Flagged ${validOpps.length} missed-question opportunities (model: ${model})`);

        return new Response(JSON.stringify({ opportunities: validOpps }), {
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