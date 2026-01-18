import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Mic, Upload, LogOut, FileText, Clock, Loader2, ListChecks, Pencil, Check, X } from "lucide-react";
import { UploadDialog } from "@/components/UploadDialog";

interface Sermon {
  id: string;
  title: string | null;
  file_url: string;
  transcription_status: string;
  duration_seconds: number | null;
  created_at: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    checkAuth();
    fetchSermons();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const fetchSermons = async () => {
    try {
      const { data, error } = await supabase
        .from("sermons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSermons(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load sermons",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      processing: "default",
      completed: "default",
      failed: "destructive",
    };

    return (
      <Badge variant={variants[status] || "outline"}>
        {status === "processing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {status}
      </Badge>
    );
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "Unknown";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleEditStart = (e: React.MouseEvent, sermon: Sermon) => {
    e.stopPropagation();
    setEditingId(sermon.id);
    setEditingTitle(sermon.title || "");
  };

  const handleEditSave = async (e: React.MouseEvent, sermonId: string) => {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from("sermons")
        .update({ title: editingTitle.trim() || null })
        .eq("id", sermonId);

      if (error) throw error;

      setSermons(sermons.map(s => 
        s.id === sermonId ? { ...s, title: editingTitle.trim() || null } : s
      ));
      toast({
        title: "Title updated",
        description: "Sermon title has been saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update title",
        variant: "destructive",
      });
    } finally {
      setEditingId(null);
    }
  };

  const handleEditCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditingTitle("");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Mic className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Preacher's Lens</h1>
              <p className="text-xs text-muted-foreground">Sermon Transcription Tool</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold">My Sermons</h2>
            <p className="text-muted-foreground">Upload and review sermon transcriptions</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/rules")} variant="outline">
              <ListChecks className="mr-2 h-4 w-4" />
              Evaluation Rules
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Sermon
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : sermons.length === 0 ? (
          <Card>
            <CardContent className="pt-8 pb-12 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No sermons yet</h3>
              <p className="text-muted-foreground mb-4">
                Upload your first sermon audio file to get started
              </p>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Sermon
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sermons.map((sermon) => (
              <Card
                key={sermon.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => sermon.transcription_status === "completed" && navigate(`/sermon/${sermon.id}`)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    {editingId === sermon.id ? (
                      <div className="flex items-center gap-1 flex-1 mr-2" onClick={e => e.stopPropagation()}>
                        <Input
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className="h-8 text-sm"
                          placeholder="Sermon title"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSave(e as any, sermon.id);
                            if (e.key === "Escape") handleEditCancel(e as any);
                          }}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => handleEditSave(e, sermon.id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleEditCancel}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <CardTitle className="text-lg">
                          {sermon.title || "Untitled Sermon"}
                        </CardTitle>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleEditStart(e, sermon)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {getStatusBadge(sermon.transcription_status)}
                  </div>
                  <CardDescription>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-3 w-3" />
                      {formatDuration(sermon.duration_seconds)}
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Uploaded {new Date(sermon.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploadComplete={fetchSermons}
      />
    </div>
  );
};

export default Dashboard;
