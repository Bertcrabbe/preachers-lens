import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import logo from "@/assets/preacherslens-logo.png";

interface SermonMetrics {
  id: string;
  title: string;
  date: string;
  wpm: number | null;
  wordCount: number | null;
  durationMin: number | null;
  engagementScore: number | null;
  questionsAsked: number | null;
  illustrationScore: number | null;
}

const CommunicatorTrends = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [communicatorName, setCommunicatorName] = useState("");
  const [metrics, setMetrics] = useState<SermonMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchTrends();
  }, [id]);

  const fetchTrends = async () => {
    setLoading(true);
    try {
      // Fetch communicator name
      const { data: comm } = await supabase
        .from("communicators")
        .select("name")
        .eq("id", id!)
        .single();
      if (comm) setCommunicatorName(comm.name);

      // Fetch completed sermons for this communicator, oldest first
      const { data: sermons } = await supabase
        .from("sermons")
        .select("id, title, created_at, duration_seconds")
        .eq("communicator_id", id!)
        .eq("transcription_status", "completed")
        .order("created_at", { ascending: true });

      if (!sermons || sermons.length === 0) {
        setMetrics([]);
        setLoading(false);
        return;
      }

      // Fetch all sentences and stored metrics in parallel
      const sermonIds = sermons.map(s => s.id);
      
      // Fetch stored metrics
      const { data: storedMetrics } = await supabase
        .from("sermon_metrics" as any)
        .select("sermon_id, engagement_score, illustration_score, congregation_questions, wpm, word_count")
        .in("sermon_id", sermonIds);

      const metricsMap: Record<string, any> = {};
      for (const m of ((storedMetrics || []) as any[])) {
        metricsMap[m.sermon_id] = m;
      }

      // Fetch sentences for sermons missing stored metrics (fallback)
      const missingIds = sermonIds.filter(id => !metricsMap[id]);
      const allSentences: any[] = [];
      if (missingIds.length > 0) {
        const batchSize = 10;
        for (let i = 0; i < missingIds.length; i += batchSize) {
          const batch = missingIds.slice(i, i + batchSize);
          let from = 0;
          const pageSize = 1000;
          while (true) {
            const { data } = await supabase
              .from("sermon_sentences")
              .select("sermon_id, sentence_text, start_time_ms, end_time_ms, order_index")
              .in("sermon_id", batch)
              .range(from, from + pageSize - 1);
            if (!data || data.length === 0) break;
            allSentences.push(...data);
            if (data.length < pageSize) break;
            from += pageSize;
          }
        }
      }

      const sentencesBySermon: Record<string, any[]> = {};
      for (const s of allSentences) {
        if (!sentencesBySermon[s.sermon_id]) sentencesBySermon[s.sermon_id] = [];
        sentencesBySermon[s.sermon_id].push(s);
      }

      // Build metrics: prefer stored, fallback to computed
      const results: SermonMetrics[] = sermons.map(sermon => {
        const stored = metricsMap[sermon.id];
        if (stored) {
          return {
            id: sermon.id,
            title: sermon.title || "Untitled",
            date: new Date(sermon.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
            wpm: stored.wpm,
            wordCount: stored.word_count,
            durationMin: sermon.duration_seconds ? Math.round(sermon.duration_seconds / 60) : null,
            engagementScore: stored.engagement_score ? Number(stored.engagement_score) : null,
            questionsAsked: stored.congregation_questions,
            illustrationScore: stored.illustration_score ? Number(stored.illustration_score) : null,
          };
        }

        // Fallback: compute from sentences
        const sentences = (sentencesBySermon[sermon.id] || []).sort((a: any, b: any) => a.order_index - b.order_index);
        let wpm: number | null = null;
        let wordCount: number | null = null;
        if (sentences.length > 0) {
          const totalWords = sentences.reduce((sum: number, s: any) => sum + s.sentence_text.split(/\s+/).filter(Boolean).length, 0);
          const totalDurationMs = sentences.reduce((sum: number, s: any) => sum + (s.end_time_ms - s.start_time_ms), 0);
          wordCount = totalWords;
          if (totalDurationMs > 0) wpm = Math.round(totalWords / (totalDurationMs / 60000));
        }
        const questionCount = sentences.filter((s: any) => s.sentence_text.trim().endsWith("?")).length;

        return {
          id: sermon.id,
          title: sermon.title || "Untitled",
          date: new Date(sermon.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
          wpm,
          wordCount,
          durationMin: sermon.duration_seconds ? Math.round(sermon.duration_seconds / 60) : null,
          engagementScore: null,
          questionsAsked: questionCount,
          illustrationScore: null,
        };
      });

      setMetrics(results);
    } catch (err) {
      console.error("Failed to load trends:", err);
    } finally {
      setLoading(false);
    }
  };

  const chartConfigs = [
    { key: "wpm", label: "Words Per Minute", color: "hsl(var(--primary))", unit: " WPM" },
    { key: "engagementScore", label: "Engagement Score", color: "hsl(var(--chart-1))", unit: "/10" },
    { key: "questionsAsked", label: "Questions Asked", color: "hsl(var(--chart-2))", unit: "" },
    { key: "illustrationScore", label: "Illustration Score", color: "hsl(var(--chart-5, 280 65% 60%))", unit: "/10" },
    { key: "wordCount", label: "Word Count", color: "hsl(var(--chart-3))", unit: " words" },
    { key: "durationMin", label: "Duration (minutes)", color: "hsl(var(--chart-4))", unit: " min" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="The Preacher's Lens" className="h-10 w-10" />
            <div>
              <h1 className="text-xl font-bold">Preacher's Lens</h1>
              <p className="text-xs text-muted-foreground">Sermon Evaluation Agent</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              {communicatorName} — Trends
            </h2>
            <p className="text-muted-foreground text-sm">
              {metrics.length} {metrics.length === 1 ? "sermon" : "sermons"} over time
            </p>
          </div>
        </div>

        {metrics.length < 2 ? (
          <Card>
            <CardContent className="pt-8 pb-12 text-center">
              <h3 className="text-lg font-semibold mb-2">Not enough data yet</h3>
              <p className="text-muted-foreground">
                Upload at least 2 completed sermons for this communicator to see trends.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {chartConfigs.map(({ key, label, color, unit }) => {
              const hasData = metrics.some((m) => (m as any)[key] != null);
              if (!hasData) return null;
              return (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{label}</CardTitle>
                    <CardDescription>Across {metrics.length} sermons</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={metrics}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11 }}
                          className="fill-muted-foreground"
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          className="fill-muted-foreground"
                          width={45}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as SermonMetrics;
                            return (
                              <div className="bg-popover border rounded-lg px-3 py-2 shadow-lg text-sm">
                                <p className="font-medium">{d.title}</p>
                                <p className="text-muted-foreground text-xs">{d.date}</p>
                                <p className="font-semibold mt-1" style={{ color }}>
                                  {payload[0].value}{unit}
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey={key}
                          stroke={color}
                          strokeWidth={2}
                          dot={{ r: 4, fill: color }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default CommunicatorTrends;
