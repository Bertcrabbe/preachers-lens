import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeneratedNote {
  sentence_index: number;
  comment_text: string;
  category?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { sermonId } = await req.json();
    if (!sermonId) throw new Error("sermonId is required");

    // Owner of this sermon (used for voice baseline)
    const { data: sermonRow, error: sermonErr } = await supabase
      .from("sermons")
      .select("user_id, title")
      .eq("id", sermonId)
      .maybeSingle();
    if (sermonErr) throw sermonErr;
    if (!sermonRow) throw new Error("Sermon not found");
    const ownerUserId = sermonRow.user_id as string;

    // Sentences with timestamps for this sermon
    const { data: sentences, error: sentErr } = await supabase
      .from("sermon_sentences")
      .select("sentence_text, start_time_ms, end_time_ms, order_index")
      .eq("sermon_id", sermonId)
      .order("order_index");
    if (sentErr) throw sentErr;
    if (!sentences || sentences.length === 0) {
      return new Response(
        JSON.stringify({ error: "Transcript not available yet for this sermon." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Voice + content baseline: user's OWN text comments across ALL their sermons.
    // Exclude rule-based (AI evaluation) comments and exclude this sermon to avoid leakage.
    const { data: pastComments } = await supabase
      .from("sermon_comments")
      .select("comment_text, created_at, sermon_id, rule_id")
      .eq("user_id", ownerUserId)
      .is("rule_id", null)
      .not("comment_text", "is", null)
      .neq("sermon_id", sermonId)
      .order("created_at", { ascending: false })
      .limit(300);

    const voiceSamplesAll = (pastComments || [])
      .map((c: any) => (c.comment_text || "").trim())
      .filter((t: string) => t.length >= 6 && t.length <= 800);

    const MAX_VOICE_CHARS = 14000;
    let runChars = 0;
    const voiceCorpus = voiceSamplesAll
      .filter((t) => {
        if (runChars + t.length + 4 > MAX_VOICE_CHARS) return false;
        runChars += t.length + 4;
        return true;
      })
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");

    // Build numbered transcript with order_index as the anchor
    const MAX_TRANSCRIPT_CHARS = 22000;
    let tChars = 0;
    const transcriptLines: string[] = [];
    for (const s of sentences) {
      const ts = `[${Math.floor((s.start_time_ms || 0) / 60000)}:${String(
        Math.floor(((s.start_time_ms || 0) % 60000) / 1000),
      ).padStart(2, "0")}]`;
      const line = `#${s.order_index} ${ts} ${s.sentence_text}`;
      if (tChars + line.length + 1 > MAX_TRANSCRIPT_CHARS) break;
      tChars += line.length + 1;
      transcriptLines.push(line);
    }
    const transcript = transcriptLines.join("\n");

    const voiceSection = voiceCorpus
      ? `Below is a corpus of the coach's OWN past written comments across many sermons. Treat this as the authoritative reference for BOTH:

1) CONTENT — what this coach habitually notices and comments on. Study the samples for recurring themes: e.g. transitions, illustrations, scripture handling, opening hooks, audience connection, vulnerability, repetition, jargon/insider language, application, the close, pacing calls, theological precision, emotional beats, etc. Your generated comments should focus on the SAME categories of things this coach notices — not generic homiletics advice. If the coach rarely comments on a category, you should also rarely comment on it.

2) VOICE — word choice, sentence length, rhythm, directness, favorite phrases, jargon they use or avoid, balance of encouragement vs. critique, and how they open/close a note.

Mirror BOTH precisely. Do NOT quote samples verbatim — absorb the patterns.

--- COACH'S OWN PAST COMMENTS (most recent first) ---
${voiceCorpus}
--- END SAMPLES ---

`
      : "";

    const userPrompt = `${voiceSection}You are reviewing a new sermon transcript. Each line is one sentence prefixed with #<order_index> and a [m:ss] timestamp. Pick 6-10 moments to comment on, weighted toward the SAME kinds of moments this coach has historically flagged in the samples above. For EACH note:

- Anchor it to ONE specific sentence by its #order_index.
- The SUBJECT MATTER of the comment must echo what this coach typically notices (see samples). Don't invent new categories they never use.
- Write in the COACH'S OWN VOICE — match their sentence length, vocabulary, directness, hedging level, and tone. Avoid generic AI-coach phrasing (no "Consider...", no "It might be helpful if...", unless the coach actually talks like that).
- Be concrete and specific to this sentence. No vague platitudes.
- Keep each comment within the typical length range you observed in the samples.
- Tag a short category (one of: opening, illustration, structure, clarity, theology, pacing, emotion, close, transition, language).

Transcript:
${transcript}

Return STRICT JSON of the form:
{
  "notes": [
    { "sentence_index": <number>, "category": "<short tag>", "comment_text": "<note in coach's voice>" }
  ]
}

Generate between 6 and 10 notes. Do not include any prose outside the JSON.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    console.log(
      `ai-coach-comments: sentences=${sentences.length}, voiceSamples=${voiceSamplesAll.length}, voiceChars=${runChars}, transcriptChars=${tChars}`,
    );

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a sermon coach. You will be given a corpus of the coach's own past comments — your job is to write feedback that sounds indistinguishable from them. Always respond with valid JSON.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
      }),
    });

    if (!aiResponse.ok) {
      const errTxt = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errTxt);
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content as string | undefined;
    if (!content) throw new Error("No content in AI response");

    content = content.trim();
    if (content.startsWith("```json")) {
      content = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: { notes?: GeneratedNote[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("JSON parse failed. Raw content:", content);
      throw new Error("AI returned invalid JSON");
    }

    const validIndices = new Set(sentences.map((s: any) => s.order_index));
    const sentenceMap = new Map<number, any>();
    for (const s of sentences) sentenceMap.set(s.order_index as number, s);

    const notes: Array<GeneratedNote & { start_time_ms: number; end_time_ms: number }> = [];
    for (const n of parsed.notes || []) {
      if (!n || typeof n.sentence_index !== "number") continue;
      if (!validIndices.has(n.sentence_index)) continue;
      const text = (n.comment_text || "").trim();
      if (!text) continue;
      const s = sentenceMap.get(n.sentence_index);
      notes.push({
        sentence_index: n.sentence_index,
        category: (n.category || "").toString().slice(0, 24),
        comment_text: text,
        start_time_ms: s.start_time_ms ?? 0,
        end_time_ms: s.end_time_ms ?? (s.start_time_ms ?? 0) + 3000,
      });
    }

    return new Response(
      JSON.stringify({ notes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("ai-coach-comments error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});