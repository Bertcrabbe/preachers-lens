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
    
    // Build numbered transcript so AI can reference sentence indices
    const numberedTranscript = sentences.map((s: any, i: number) => `[${i}] ${s.sentence_text}`).join("\n");
    
    // Truncate to avoid exceeding AI context limits and reduce latency
    const maxChars = 30000;
    const transcript = numberedTranscript.length > maxChars 
      ? numberedTranscript.substring(0, maxChars) + "\n\n[TRANSCRIPT TRUNCATED]"
      : numberedTranscript;

    console.log(`Transcript length: ${numberedTranscript.length} chars, sending: ${transcript.length} chars`);

    // Use fastest models first to minimize response time
    const models = ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "openai/gpt-5-nano"];
    // Per-model timeout budget so we never exceed the 150s edge function limit
    const PER_MODEL_TIMEOUT_MS = 45000;
    let lastError = "";

    for (const model of models) {
      console.log(`Trying model: ${model}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
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
                content: `Analyze this sermon transcript. Each sentence is numbered with [index]. Identify ALL scripture references. Rules:
1. Only count verses actually READ or QUOTED.
2. Consolidate consecutive verses into ranges (e.g., "Romans 1:29-31").
3. Count individual verses per reference.
4. For "scripture_sentence_indices", list ALL sentence indices [n] that contain or are part of scripture being read/quoted. This includes:
   - Sentences where the preacher is reading scripture aloud
   - Sentences that are direct quotes from the Bible (even if the preacher doesn't explicitly say the reference)
   - Questions that come from scripture (e.g., Jesus asking "Do you think I came to bring peace?")
   Be thorough - include EVERY sentence that is part of a scripture passage being read.

Respond with ONLY valid JSON (no markdown):
{"references": [{"reference": "Romans 6:1-4", "context": "brief quote", "verse_count": 4}], "total_count": 1, "total_verses": 4, "scripture_sentence_indices": [0, 1, 2, 3]}

Transcript:\n\n${transcript}`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`Model ${model} error:`, aiResponse.status, errorText);
          lastError = `${model}: ${aiResponse.status}`;
          clearTimeout(timeoutId);
          continue;
        }

        const aiResult = await aiResponse.json();
        const content = aiResult.choices[0].message.content;
        
        const jsonStr = content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const result = JSON.parse(jsonStr);
        
        // Ensure scripture_sentence_indices is always an array
        if (!result.scripture_sentence_indices) {
          result.scripture_sentence_indices = [];
        }

        // Deduplicate references and consolidate overlapping verse ranges so we
        // don't count the same verse twice (e.g. "Romans 6:1-4" and "Romans 6:3").
        if (Array.isArray(result.references)) {
          // Parse a reference like "Romans 6:1-4" or "1 John 2:3" into structured form
          const parseRef = (ref: string): { book: string; chapter: number; start: number; end: number } | null => {
            const m = ref.trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?$/);
            if (!m) return null;
            const book = m[1].trim().toLowerCase().replace(/\s+/g, " ");
            const chapter = parseInt(m[2], 10);
            const start = parseInt(m[3], 10);
            const end = m[4] ? parseInt(m[4], 10) : start;
            if (isNaN(chapter) || isNaN(start) || isNaN(end)) return null;
            return { book, chapter, start, end: Math.max(start, end) };
          };

          // Group verse ranges per book+chapter and merge overlaps
          const groups = new Map<string, { ranges: [number, number][]; original: any[] }>();
          const unparseable: any[] = [];
          for (const r of result.references) {
            const parsed = parseRef(String(r.reference || ""));
            if (!parsed) {
              unparseable.push(r);
              continue;
            }
            const key = `${parsed.book}|${parsed.chapter}`;
            if (!groups.has(key)) groups.set(key, { ranges: [], original: [] });
            const g = groups.get(key)!;
            g.ranges.push([parsed.start, parsed.end]);
            g.original.push({ ...r, _parsed: parsed });
          }

          const merged: any[] = [];
          let totalVerses = 0;
          for (const [key, g] of groups) {
            g.ranges.sort((a, b) => a[0] - b[0]);
            const stack: [number, number][] = [];
            for (const [s, e] of g.ranges) {
              if (stack.length && s <= stack[stack.length - 1][1] + 1) {
                stack[stack.length - 1][1] = Math.max(stack[stack.length - 1][1], e);
              } else {
                stack.push([s, e]);
              }
            }
            const first = g.original[0]._parsed;
            // Capitalize book words
            const bookDisplay = first.book.replace(/\b\w/g, (c: string) => c.toUpperCase());
            for (const [s, e] of stack) {
              const refStr = s === e
                ? `${bookDisplay} ${first.chapter}:${s}`
                : `${bookDisplay} ${first.chapter}:${s}-${e}`;
              const verseCount = e - s + 1;
              totalVerses += verseCount;
              // Pick the longest context from any original ref overlapping this merged range
              const ctx = g.original
                .filter((o) => o._parsed.start <= e && o._parsed.end >= s)
                .map((o) => o.context || "")
                .reduce((a, b) => (b.length > a.length ? b : a), "");
              merged.push({ reference: refStr, context: ctx, verse_count: verseCount });
            }
          }

          // Add any unparseable refs as-is (count their stated verse_count once)
          for (const r of unparseable) {
            merged.push(r);
            totalVerses += Number(r.verse_count) || 0;
          }

          result.references = merged;
          result.total_count = merged.length;
          result.total_verses = totalVerses;
        }

        console.log(`Found ${result.scripture_sentence_indices.length} scripture sentence indices, ${result.references?.length || 0} refs, ${result.total_verses} verses`);

        clearTimeout(timeoutId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (modelError: any) {
        clearTimeout(timeoutId);
        const isAbort = modelError?.name === "AbortError";
        console.error(`Model ${model} failed${isAbort ? " (timeout)" : ""}:`, modelError);
        lastError = `${model}: ${isAbort ? "timeout" : modelError}`;
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
