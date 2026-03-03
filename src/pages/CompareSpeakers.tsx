import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import logo from "@/assets/preacherslens-logo.png";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5, 280 65% 60%))",
  "#e11d48",
  "#059669",
];

interface Communicator {
  id: string;
  name: string;
}

interface SermonDataPoint {
  sermonIndex: number;
  date: string;
  title: string;
  communicatorId: string;
  communicatorName: string;
  wpm: number | null;
}

const CompareSpeakers = () => {
  const navigate = useNavigate();
  const [communicators, setCommunicators] = useState<Communicator[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [sermonData, setSermonData] = useState<Record<string, SermonDataPoint[]>>({});

  useEffect(() => {
    fetchCommunicators();
  }, []);

  useEffect(() => {
    if (selectedIds.length > 0) {
      fetchComparisonData();
    }
  }, [selectedIds]);

  const fetchCommunicators = async () => {
    const { data } = await supabase
      .from("communicators")
      .select("id, name")
      .order("name");
    setCommunicators(data || []);
    setLoading(false);
  };

  const fetchComparisonData = async () => {
    setDataLoading(true);
    try {
      // Fetch sermons + metrics for all selected communicators
      const newData: Record<string, SermonDataPoint[]> = {};

      for (const commId of selectedIds) {
        if (sermonData[commId]) {
          newData[commId] = sermonData[commId];
          continue;
        }

        const comm = communicators.find(c => c.id === commId);
        const { data: sermons } = await supabase
          .from("sermons")
          .select("id, title, created_at")
          .eq("communicator_id", commId)
          .eq("transcription_status", "completed")
          .order("created_at", { ascending: true });

        if (!sermons || sermons.length === 0) {
          newData[commId] = [];
          continue;
        }

        const sermonIds = sermons.map(s => s.id);
        const { data: metrics } = await supabase
          .from("sermon_metrics")
          .select("sermon_id, wpm")
          .in("sermon_id", sermonIds);

        const metricsMap: Record<string, number | null> = {};
        for (const m of (metrics || [])) {
          metricsMap[m.sermon_id] = m.wpm;
        }

        newData[commId] = sermons.map((s, idx) => ({
          sermonIndex: idx + 1,
          date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
          title: s.title || "Untitled",
          communicatorId: commId,
          communicatorName: comm?.name || "Unknown",
          wpm: metricsMap[s.id] ?? null,
        }));
      }

      setSermonData(newData);
    } finally {
      setDataLoading(false);
    }
  };

  const toggleCommunicator = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Build unified chart data - each communicator gets its own WPM column keyed by sermon index
  const chartData = useMemo(() => {
    if (selectedIds.length === 0) return [];

    const maxSermons = Math.max(
      ...selectedIds.map(id => (sermonData[id] || []).filter(d => d.wpm != null).length),
      0
    );

    if (maxSermons === 0) return [];

    const rows: Record<string, any>[] = [];
    for (let i = 0; i < maxSermons; i++) {
      const row: Record<string, any> = { index: i + 1 };
      for (const commId of selectedIds) {
        const points = (sermonData[commId] || []).filter(d => d.wpm != null);
        if (i < points.length) {
          row[commId] = points[i].wpm;
          row[`${commId}_title`] = points[i].title;
          row[`${commId}_date`] = points[i].date;
        }
      }
      rows.push(row);
    }
    return rows;
  }, [selectedIds, sermonData]);

  // Compute averages per selected communicator
  const averages = useMemo(() => {
    return selectedIds.map(id => {
      const points = (sermonData[id] || []).filter(d => d.wpm != null);
      const comm = communicators.find(c => c.id === id);
      const avgWpm = points.length > 0
        ? Math.round(points.reduce((sum, p) => sum + (p.wpm || 0), 0) / points.length)
        : null;
      return {
        id,
        name: comm?.name || "Unknown",
        avgWpm,
        sermonCount: points.length,
      };
    });
  }, [selectedIds, sermonData, communicators]);

  const selectedComms = communicators.filter(c => selectedIds.includes(c.id));

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
        <div className="container mx-auto px-4 py-4 flex items-center gap-2">
          <img src={logo} alt="The Preacher's Lens" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-bold">Preacher's Lens</h1>
            <p className="text-xs text-muted-foreground">Sermon Evaluation Agent</p>
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
              <Users className="h-6 w-6 text-primary" />
              Compare Speakers
            </h2>
            <p className="text-muted-foreground text-sm">
              Select communicators to compare their speaking pace over time
            </p>
          </div>
        </div>

        {/* Communicator selection */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Communicators</CardTitle>
            <CardDescription>Choose 2 or more to compare</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {communicators.map((comm, idx) => (
                <label
                  key={comm.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded-md px-3 py-2 transition-colors"
                >
                  <Checkbox
                    checked={selectedIds.includes(comm.id)}
                    onCheckedChange={() => toggleCommunicator(comm.id)}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: selectedIds.includes(comm.id)
                        ? COLORS[selectedIds.indexOf(comm.id) % COLORS.length]
                        : undefined,
                    }}
                  >
                    {comm.name}
                  </span>
                </label>
              ))}
            </div>
            {communicators.length === 0 && (
              <p className="text-muted-foreground text-sm">No communicators found. Upload some sermons first.</p>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        {selectedIds.length >= 2 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Speaking Pace (WPM) Over Time</CardTitle>
              <CardDescription>
                Each point represents a sermon in chronological order
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataLoading ? (
                <div className="flex items-center justify-center h-[300px]">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                  No WPM data available for the selected communicators. Try refreshing metrics on their Trends pages.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="index"
                      tick={{ fontSize: 11 }}
                      label={{ value: "Sermon #", position: "insideBottom", offset: -5, fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      width={50}
                      label={{ value: "WPM", angle: -90, position: "insideLeft", fontSize: 12 }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-popover border rounded-lg px-3 py-2 shadow-lg text-sm space-y-1">
                            {payload.map((entry: any) => {
                              const commId = entry.dataKey;
                              const comm = communicators.find(c => c.id === commId);
                              const title = entry.payload[`${commId}_title`];
                              const date = entry.payload[`${commId}_date`];
                              return (
                                <div key={commId}>
                                  <p className="font-medium" style={{ color: entry.color }}>
                                    {comm?.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{title} • {date}</p>
                                  <p className="font-semibold">{entry.value} WPM</p>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      formatter={(value: string) => {
                        const comm = communicators.find(c => c.id === value);
                        return comm?.name || value;
                      }}
                    />
                    {selectedIds.map((commId, idx) => (
                      <Line
                        key={commId}
                        type="monotone"
                        dataKey={commId}
                        stroke={COLORS[idx % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4, fill: COLORS[idx % COLORS.length] }}
                        connectNulls
                        name={commId}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {selectedIds.length === 1 && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
              Select at least one more communicator to compare.
            </CardContent>
          </Card>
        )}

        {/* Averages comparison */}
        {selectedIds.length >= 1 && !dataLoading && averages.some(a => a.avgWpm != null) && (
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Average Speaking Pace</CardTitle>
              <CardDescription>Mean WPM across all sermons per communicator</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(() => {
                  const maxWpm = Math.max(...averages.filter(a => a.avgWpm != null).map(a => a.avgWpm!));
                  return averages.map((a, idx) => (
                    <div key={a.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium" style={{ color: COLORS[idx % COLORS.length] }}>
                          {a.name}
                        </span>
                        <span className="text-muted-foreground">
                          {a.avgWpm != null ? `${a.avgWpm} WPM` : "No data"}{" "}
                          <span className="text-xs">({a.sermonCount} sermon{a.sermonCount !== 1 ? "s" : ""})</span>
                        </span>
                      </div>
                      {a.avgWpm != null && (
                        <div className="h-3 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${(a.avgWpm / maxWpm) * 100}%`,
                              backgroundColor: COLORS[idx % COLORS.length],
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default CompareSpeakers;
