import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Play,
  Pause,
  Download,
  Loader2,
  FileText,
  List,
  AlignLeft,
  MessageSquare,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Sermon {
  id: string;
  title: string | null;
  file_url: string;
  transcription_status: string;
  duration_seconds: number | null;
}

interface Sentence {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  sentence_text: string;
  order_index: number;
}

interface Comment {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  comment_text: string;
  created_at: string;
}

const SermonViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"sentence" | "paragraph">("sentence");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number; end: number } | null>(null);
  const [newComment, setNewComment] = useState("");

  useEffect(() => {
    checkAuth();
    if (id) {
      fetchSermon();
      fetchSentences();
      fetchComments();
    }
  }, [id]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const fetchSermon = async () => {
    try {
      const { data, error } = await supabase
        .from("sermons")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setSermon(data);

      const { data: urlData } = await supabase.storage
        .from("sermons")
        .createSignedUrl(data.file_url, 3600);

      if (urlData) {
        setAudioUrl(urlData.signedUrl);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load sermon",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSentences = async () => {
    try {
      const { data, error } = await supabase
        .from("sermon_sentences")
        .select("*")
        .eq("sermon_id", id)
        .order("order_index");

      if (error) throw error;
      setSentences(data || []);
    } catch (error: any) {
      console.error("Failed to load sentences:", error);
    }
  };

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from("sermon_comments")
        .select("*")
        .eq("sermon_id", id)
        .order("created_at");

      if (error) throw error;
      setComments(data || []);
    } catch (error: any) {
      console.error("Failed to load comments:", error);
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const seekToTime = (ms: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = ms / 1000;
    if (!playing) {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleExport = async (format: string) => {
    if (!sermon) return;
    
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-sermon", {
        body: { sermonId: sermon.id, format },
      });

      if (error) throw error;

      // Create download link
      const blob = new Blob([data], { type: "application/octet-stream" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sermon.title || "sermon"}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Export successful",
        description: `Transcript exported as ${format.toUpperCase()}`,
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const isCurrentSentence = (sentence: Sentence) => {
    const currentMs = currentTime * 1000;
    return currentMs >= sentence.start_time_ms && currentMs <= sentence.end_time_ms;
  };

  const groupIntoParagraphs = () => {
    const paragraphs: Array<{
      sentences: Sentence[];
      startTime: number;
      endTime: number;
      text: string;
    }> = [];
    
    let currentParagraph: Sentence[] = [];
    const sentencesPerParagraph = 5; // Group every 5 sentences
    
    sentences.forEach((sentence, index) => {
      currentParagraph.push(sentence);
      
      if (currentParagraph.length === sentencesPerParagraph || index === sentences.length - 1) {
        paragraphs.push({
          sentences: [...currentParagraph],
          startTime: currentParagraph[0].start_time_ms,
          endTime: currentParagraph[currentParagraph.length - 1].end_time_ms,
          text: currentParagraph.map(s => s.sentence_text).join(" "),
        });
        currentParagraph = [];
      }
    });
    
    return paragraphs;
  };

  const isCurrentParagraph = (paragraph: { startTime: number; endTime: number }) => {
    const currentMs = currentTime * 1000;
    return currentMs >= paragraph.startTime && currentMs <= paragraph.endTime;
  };

  const openCommentDialog = (startTime: number, endTime: number) => {
    setSelectedTimeRange({ start: startTime, end: endTime });
    setNewComment("");
    setCommentDialogOpen(true);
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedTimeRange || !id) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("sermon_comments").insert({
        sermon_id: id,
        user_id: user.id,
        start_time_ms: selectedTimeRange.start,
        end_time_ms: selectedTimeRange.end,
        comment_text: newComment.trim(),
      });

      if (error) throw error;

      toast({
        title: "Comment added",
        description: "Your comment has been saved",
      });

      setCommentDialogOpen(false);
      setNewComment("");
      fetchComments();
    } catch (error: any) {
      toast({
        title: "Failed to add comment",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getCommentsForRange = (startTime: number, endTime: number) => {
    return comments.filter(
      (c) => c.start_time_ms === startTime && c.end_time_ms === endTime
    );
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase
        .from("sermon_comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;

      toast({
        title: "Comment deleted",
        description: "Your comment has been removed",
      });

      fetchComments();
    } catch (error: any) {
      toast({
        title: "Failed to delete comment",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!sermon) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-6 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sermon not found</h2>
          <Button onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting || sentences.length === 0}>
                  {exporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("txt")}>
                  Plain Text (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("md")}>
                  Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  PDF Document (.pdf)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("docx")}>
                  Word Document (.docx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{sermon.title || "Untitled Sermon"}</h1>
          <Badge>{sermon.transcription_status}</Badge>
        </div>

        {audioUrl && (
          <Card className="p-6 mb-8">
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-12 rounded-full"
                onClick={togglePlayPause}
              >
                {playing ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 ml-0.5" />
                )}
              </Button>
              <div className="flex-1">
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onEnded={() => setPlaying(false)}
                  className="w-full"
                  controls
                />
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Transcript</h2>
            <div className="flex gap-2">
              <Button
                variant={viewMode === "sentence" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("sentence")}
              >
                <List className="h-4 w-4 mr-2" />
                Sentences
              </Button>
              <Button
                variant={viewMode === "paragraph" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("paragraph")}
              >
                <AlignLeft className="h-4 w-4 mr-2" />
                Paragraphs
              </Button>
            </div>
          </div>
          {sentences.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Transcription in progress...</p>
            </Card>
          ) : viewMode === "sentence" ? (
            <div className="space-y-1">
              {sentences.map((sentence) => {
                const sentenceComments = getCommentsForRange(sentence.start_time_ms, sentence.end_time_ms);
                return (
                  <div key={sentence.id}>
                    <div
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isCurrentSentence(sentence)
                          ? "bg-primary/10 border-l-4 border-primary"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => seekToTime(sentence.start_time_ms)}
                    >
                      <div className="flex gap-3">
                        <span className="text-sm font-mono text-muted-foreground min-w-[60px]">
                          {formatTimestamp(sentence.start_time_ms)}
                        </span>
                        <p className="flex-1">{sentence.sentence_text}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCommentDialog(sentence.start_time_ms, sentence.end_time_ms);
                          }}
                        >
                          <MessageSquare className="h-4 w-4" />
                          {sentenceComments.length > 0 && (
                            <span className="ml-1 text-xs">{sentenceComments.length}</span>
                          )}
                        </Button>
                      </div>
                    </div>
                    {sentenceComments.length > 0 && (
                      <div className="ml-20 mt-1 space-y-1">
                        {sentenceComments.map((comment) => (
                          <div key={comment.id} className="bg-muted/50 p-2 rounded text-sm flex justify-between items-start">
                            <p className="flex-1">{comment.comment_text}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleDeleteComment(comment.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {groupIntoParagraphs().map((paragraph, index) => {
                const paragraphComments = getCommentsForRange(paragraph.startTime, paragraph.endTime);
                return (
                  <div key={index}>
                    <div
                      className={`p-4 rounded-lg cursor-pointer transition-colors ${
                        isCurrentParagraph(paragraph)
                          ? "bg-primary/10 border-l-4 border-primary"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => seekToTime(paragraph.startTime)}
                    >
                      <div className="flex gap-3">
                        <span className="text-sm font-mono text-muted-foreground min-w-[60px]">
                          {formatTimestamp(paragraph.startTime)}
                        </span>
                        <p className="flex-1 leading-relaxed">{paragraph.text}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCommentDialog(paragraph.startTime, paragraph.endTime);
                          }}
                        >
                          <MessageSquare className="h-4 w-4" />
                          {paragraphComments.length > 0 && (
                            <span className="ml-1 text-xs">{paragraphComments.length}</span>
                          )}
                        </Button>
                      </div>
                    </div>
                    {paragraphComments.length > 0 && (
                      <div className="ml-20 mt-2 space-y-2">
                        {paragraphComments.map((comment) => (
                          <div key={comment.id} className="bg-muted/50 p-3 rounded text-sm flex justify-between items-start">
                            <p className="flex-1">{comment.comment_text}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleDeleteComment(comment.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Comment</DialogTitle>
              <DialogDescription>
                Add a note or comment for this section
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Textarea
                placeholder="Enter your comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={4}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddComment} disabled={!newComment.trim()}>
                  Add Comment
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default SermonViewer;
