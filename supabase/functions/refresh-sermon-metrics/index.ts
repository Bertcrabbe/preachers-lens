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
    const { sermonIds, userId } = await req.json();

    if (!sermonIds || !Array.isArray(sermonIds) || sermonIds.length === 0) {
      throw new Error("sermonIds array is required");
    }
    if (!userId) {
      throw new Error("userId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    const results: Array<{ sermonId: string; status: string; error?: string }> = [];

    for (const sermonId of sermonIds) {
      try {
        // Fetch sentences for this sermon
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
          if (!res.ok) { await res.text(); break; }
          const data = await res.json();
          if (!data || data.length === 0) break;
          allSentences.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        if (allSentences.length === 0) {
          results.push({ sermonId, status: "skipped", error: "No sentences" });
          continue;
        }

        // Compute WPM and word count
        const totalWords = allSentences.reduce((sum: number, s: any) =>
          sum + s.sentence_text.split(/\s+/).filter(Boolean).length, 0);
        const totalDurationMs = allSentences.reduce((sum: number, s: any) =>
          sum + (s.end_time_ms - s.start_time_ms), 0);
        const wpm = totalDurationMs > 0 ? Math.round(totalWords / (totalDurationMs / 60000)) : null;

        // Call classify-questions
        let congregationQuestions: number | null = null;
        try {
          const qRes = await fetch(`${supabaseUrl}/functions/v1/classify-questions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ sermonId }),
          });
          if (qRes.ok) {
            const qData = await qRes.json();
            congregationQuestions = qData.congregation_indices?.length ?? null;
          } else {
            await qRes.text();
          }
        } catch (e) {
          console.error(`classify-questions failed for ${sermonId}:`, e);
        }

        // Call analyze-illustrations
        let illustrationScore: number | null = null;
        if (lovableApiKey) {
          try {
            const iRes = await fetch(`${supabaseUrl}/functions/v1/analyze-illustrations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ sermonId }),
            });
            if (iRes.ok) {
              const iData = await iRes.json();
              illustrationScore = iData.illustration_score ?? null;
            } else {
              await iRes.text();
            }
          } catch (e) {
            console.error(`analyze-illustrations failed for ${sermonId}:`, e);
          }
        }

        // Call analyze-emotional-resonance
        let emotionalResonanceScore: number | null = null;
        if (lovableApiKey) {
          try {
            const eRes = await fetch(`${supabaseUrl}/functions/v1/analyze-emotional-resonance`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ sermonId }),
            });
            if (eRes.ok) {
              const eData = await eRes.json();
              emotionalResonanceScore = eData.overall_score ?? null;
            } else {
              await eRes.text();
            }
          } catch (e) {
            console.error(`analyze-emotional-resonance failed for ${sermonId}:`, e);
          }
        }

        // Upsert metrics
        const upsertRes = await fetch(
          `${supabaseUrl}/rest/v1/sermon_metrics?on_conflict=sermon_id`,
          {
            method: "POST",
            headers: {
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify({
              sermon_id: sermonId,
              user_id: userId,
              wpm,
              word_count: totalWords,
              congregation_questions: congregationQuestions,
              illustration_score: illustrationScore,
              emotional_resonance_score: emotionalResonanceScore,
              updated_at: new Date().toISOString(),
            }),
          }
        );

        if (!upsertRes.ok) {
          const errText = await upsertRes.text();
          console.error(`Upsert failed for ${sermonId}:`, errText);
          results.push({ sermonId, status: "error", error: errText });
        } else {
          await upsertRes.text();
          results.push({ sermonId, status: "ok" });
        }
      } catch (sermonErr) {
        console.error(`Error processing ${sermonId}:`, sermonErr);
        results.push({ sermonId, status: "error", error: sermonErr instanceof Error ? sermonErr.message : "Unknown" });
      }
    }

    return new Response(JSON.stringify({ results }), {
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
