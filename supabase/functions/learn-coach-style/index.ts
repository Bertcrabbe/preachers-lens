import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_COMMENTS_PER_USER = 600; // most recent N text comments
const MAX_GUIDE_CHARS = 6000;

interface CommentRow {
  comment_text: string;
  start_time_ms: number;
  end_time_ms: number;
  sermon_id: string;
}

async function buildGuideForUser(admin: ReturnType<typeof createClient>, userId: string) {
  // Fetch only the user's OWN text comments — exclude AI Coach comments and rule-tagged ones.
  const { data: comments, error } = await admin
    .from("sermon_comments")
    .select("comment_text, start_time_ms, end_time_ms, sermon_id, rule_id")
    .eq("user_id", userId)
    .is("rule_id", null)
    .order("created_at", { ascending: false })
    .limit(MAX_COMMENTS_PER_USER);
  if (error) throw error;

  const own = (comments || []).filter((c: any) => {
    const t = (c.comment_text || "").trim();
    if (!t) return false;
    if (/^\s*\[AI Coach\]/i.test(t)) return false;
    return true;
  }) as CommentRow[];

  if (own.length < 5) {
    return { skipped: true, reason: "not enough own comments", count: own.length };
  }

  // Build the corpus. Keep it compact.
  const lines = own.map((c, i) => {
    const ts = `${Math.floor(c.start_time_ms / 60000)}:${String(
      Math.floor((c.start_time_ms % 60000) / 1000),
    ).padStart(2, "0")}`;
    return `[${i + 1} @ ${ts}] ${c.comment_text.replace(/\s+/g, " ").trim()}`;
  });
  let corpus = lines.join("\n");
  // Keep under ~30k chars for the model
  if (corpus.length > 30000) corpus = corpus.slice(0, 30000) + "\n…(truncated)";

  const systemPrompt = `You are a meta-coach. You are reading a preacher's OWN coaching comments — the things he says when he's reviewing other people's sermons (or his own). Your job is to distill HIS coaching voice and his priorities into a tight style guide that another AI ("Digital Bert") will use to generate comments in his voice.

Produce a STYLE GUIDE in markdown with these sections, each tight and concrete:

## What he praises
- Specific things he celebrates (clarity, vulnerability, a sharp turn, a good question, etc.)

## What he flags / corrects
- Specific things he flags as needing work (pacing, hedging, abstract language, missed pauses, etc.)

## How he opens notes
- Recurring openers, vocatives, energy level

## Signature phrases & vocabulary
- 8-20 phrases or words he reuses. Quote them.

## Phrases / habits to AVOID
- Anything you see he NEVER says, OR overused phrases that should be retired

## Recurring observation patterns
- 5-10 "if you see X, say Y" patterns drawn from his actual comments

## Tone & cadence
- 3-6 lines on his rhythm, sentence length, directness, humor

Rules:
- Be SPECIFIC. Quote actual snippets where useful.
- Do NOT include fluff, intro, outro, or "I hope this helps." Just the guide.
- Stay under ${MAX_GUIDE_CHARS} characters total.
- This is internal — write it FOR another AI, not for the preacher to read.`;

  const userPrompt = `Here are ${own.length} comments this preacher has written, most recent first. Distill the style guide.\n\n${corpus}`;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const aiResp = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    throw new Error(`AI gateway ${aiResp.status}: ${errText.slice(0, 300)}`);
  }
  const aiJson = await aiResp.json();
  let guideText: string = aiJson?.choices?.[0]?.message?.content || "";
  guideText = guideText.trim();
  if (!guideText) throw new Error("Empty guide from model");
  if (guideText.length > MAX_GUIDE_CHARS) guideText = guideText.slice(0, MAX_GUIDE_CHARS);

  // Upsert into coach_style_guides
  const { error: upErr } = await admin
    .from("coach_style_guides")
    .upsert(
      {
        user_id: userId,
        guide_text: guideText,
        comments_analyzed: own.length,
        last_analyzed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (upErr) throw upErr;

  return { ok: true, count: own.length, guide_chars: guideText.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch { /* allow empty body for cron */ }
    const mode = body?.mode as string | undefined; // "self" | "all"
    const requestedUserId = body?.userId as string | undefined;

    let targetUserIds: string[] = [];

    if (mode === "all") {
      // Cron path — find distinct user_ids that have any non-rule, non-AI-coach comment
      const { data: rows, error } = await admin
        .from("sermon_comments")
        .select("user_id")
        .is("rule_id", null)
        .limit(5000);
      if (error) throw error;
      targetUserIds = Array.from(new Set((rows || []).map((r: any) => r.user_id))).filter(Boolean);
    } else {
      // User-triggered: require auth and use that user
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "no auth" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userErr } = await userClient.auth.getUser();
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "unauth" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetUserIds = [requestedUserId && requestedUserId === user.id ? requestedUserId : user.id];
    }

    const results: Array<{ user_id: string; result: any }> = [];
    for (const uid of targetUserIds) {
      try {
        const r = await buildGuideForUser(admin, uid);
        results.push({ user_id: uid, result: r });
      } catch (e) {
        console.error("learn-coach-style failed for", uid, e);
        results.push({ user_id: uid, result: { error: e instanceof Error ? e.message : "Unknown" } });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("learn-coach-style error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});