import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Mic, Upload, LogOut, FileText, Clock, Loader2, ListChecks, Pencil, Check, X, FolderOpen, ArrowLeft, Plus, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import { UploadDialog } from "@/components/UploadDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommunicatorLinks } from "@/components/CommunicatorLinks";

interface Sermon {
  id: string;
  title: string | null;
  file_url: string;
  transcription_status: string;
  duration_seconds: number | null;
  created_at: string;
  communicator_id: string | null;
}

interface Communicator {
  id: string;
  name: string;
  created_at: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [communicators, setCommunicators] = useState<Communicator[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [selectedCommunicator, setSelectedCommunicator] = useState<Communicator | null>(null);
  const [newCommunicatorOpen, setNewCommunicatorOpen] = useState(false);
  const [newCommunicatorName, setNewCommunicatorName] = useState("");
  const [deleteCommunicatorOpen, setDeleteCommunicatorOpen] = useState(false);
  const [communicatorToDelete, setCommunicatorToDelete] = useState<Communicator | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        if (!session) {
          navigate("/auth");
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          // Re-fetch data when user signs in or token refreshes
          fetchData();
        }
      }
    );

    // THEN check for existing session and fetch data
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (!session) {
          navigate("/auth");
        } else {
          // Session exists, fetch data
          await fetchData();
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const fetchData = async () => {
    try {
      const [sermonsRes, communicatorsRes] = await Promise.all([
        supabase.from("sermons").select("*").order("created_at", { ascending: false }),
        supabase.from("communicators").select("*").order("name", { ascending: true })
      ]);

      if (sermonsRes.error) throw sermonsRes.error;
      if (communicatorsRes.error) throw communicatorsRes.error;

      setSermons(sermonsRes.data || []);
      setCommunicators(communicatorsRes.data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load data",
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

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
    toast({
      title: "Data refreshed",
      description: "Communicators and sermons have been updated",
    });
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
        {status === "completed" ? (
          <>
            Transcript
            <Check className="ml-1 h-3 w-3" />
          </>
        ) : (
          status.charAt(0).toUpperCase() + status.slice(1)
        )}
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

  const handleCreateCommunicator = async () => {
    if (!newCommunicatorName.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("communicators")
        .insert({ name: newCommunicatorName.trim(), user_id: user.id })
        .select()
        .single();

      if (error) throw error;

      setCommunicators([...communicators, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCommunicatorName("");
      setNewCommunicatorOpen(false);
      toast({
        title: "Folder created",
        description: `Created folder for ${data.name}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to create folder",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCommunicator = async () => {
    if (!communicatorToDelete) return;

    try {
      const { error } = await supabase
        .from("communicators")
        .delete()
        .eq("id", communicatorToDelete.id);

      if (error) throw error;

      setCommunicators(communicators.filter(c => c.id !== communicatorToDelete.id));
      setCommunicatorToDelete(null);
      setDeleteCommunicatorOpen(false);
      toast({
        title: "Folder deleted",
        description: `Deleted folder for ${communicatorToDelete.name}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to delete folder",
        variant: "destructive",
      });
    }
  };

  const handleAssignCommunicator = async (sermonId: string, communicatorId: string | null) => {
    try {
      const { error } = await supabase
        .from("sermons")
        .update({ communicator_id: communicatorId })
        .eq("id", sermonId);

      if (error) throw error;

      setSermons(sermons.map(s => 
        s.id === sermonId ? { ...s, communicator_id: communicatorId } : s
      ));
      
      const folderName = communicatorId 
        ? communicators.find(c => c.id === communicatorId)?.name 
        : "Unassigned";
      toast({
        title: "Sermon moved",
        description: `Moved to ${folderName}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to move sermon",
        variant: "destructive",
      });
    }
  };

  const getSermonsForCommunicator = (communicatorId: string | null) => {
    return sermons.filter(s => s.communicator_id === communicatorId);
  };

  const unassignedSermons = sermons.filter(s => !s.communicator_id);

  const renderSermonCard = (sermon: Sermon) => {
    const currentCommunicator = communicators.find(c => c.id === sermon.communicator_id);
    
    return (
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Uploaded {new Date(sermon.created_at).toLocaleDateString()}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {currentCommunicator?.name || "Unassigned"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-50 bg-popover">
                {communicators.map((communicator) => (
                  <DropdownMenuItem
                    key={communicator.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAssignCommunicator(sermon.id, communicator.id);
                    }}
                    className={sermon.communicator_id === communicator.id ? "bg-accent" : ""}
                  >
                    {communicator.name}
                  </DropdownMenuItem>
                ))}
                {communicators.length > 0 && sermon.communicator_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAssignCommunicator(sermon.id, null);
                      }}
                    >
                      Remove from folder
                    </DropdownMenuItem>
                  </>
                )}
                {communicators.length === 0 && (
                  <DropdownMenuItem disabled>
                    No folders created yet
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderFolderView = () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {communicators.map((communicator) => {
        const sermonCount = getSermonsForCommunicator(communicator.id).length;
        return (
          <Card
            key={communicator.id}
            className="cursor-pointer hover:shadow-lg transition-shadow group"
            onClick={() => setSelectedCommunicator(communicator)}
          >
            <CardHeader>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{communicator.name}</CardTitle>
                    <CardDescription>
                      {sermonCount} {sermonCount === 1 ? "sermon" : "sermons"}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCommunicatorToDelete(communicator);
                    setDeleteCommunicatorOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CommunicatorLinks communicatorId={communicator.id} compact />
            </CardContent>
          </Card>
        );
      })}

      {/* Unassigned sermons folder */}
      {unassignedSermons.length > 0 && (
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow border-dashed"
          onClick={() => setSelectedCommunicator({ id: "unassigned", name: "Unassigned", created_at: "" })}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg text-muted-foreground">Unassigned</CardTitle>
                <CardDescription>
                  {unassignedSermons.length} {unassignedSermons.length === 1 ? "sermon" : "sermons"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Add new communicator card */}
      <Card
        className="cursor-pointer hover:shadow-lg transition-shadow border-dashed"
        onClick={() => setNewCommunicatorOpen(true)}
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg text-muted-foreground">Add Communicator</CardTitle>
              <CardDescription>Create a new folder</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );

  const renderCommunicatorSermons = () => {
    const sermonsToShow = selectedCommunicator?.id === "unassigned" 
      ? unassignedSermons 
      : getSermonsForCommunicator(selectedCommunicator?.id || "");

    return (
      <>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setSelectedCommunicator(null)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h2 className="text-2xl font-bold">{selectedCommunicator?.name}</h2>
              <p className="text-muted-foreground">
                {sermonsToShow.length} {sermonsToShow.length === 1 ? "sermon" : "sermons"}
              </p>
            </div>
          </div>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Sermon
          </Button>
        </div>

        {selectedCommunicator?.id !== "unassigned" && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Links</CardTitle>
            </CardHeader>
            <CardContent>
              <CommunicatorLinks communicatorId={selectedCommunicator!.id} />
            </CardContent>
          </Card>
        )}

        {sermonsToShow.length === 0 ? (
          <Card>
            <CardContent className="pt-8 pb-12 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No sermons yet</h3>
              <p className="text-muted-foreground mb-4">
                Upload a sermon for {selectedCommunicator?.name}
              </p>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Sermon
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sermonsToShow.map(renderSermonCard)}
          </div>
        )}
      </>
    );
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!selectedCommunicator ? (
          <>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold">Communicators</h2>
                <p className="text-muted-foreground">Organize sermons by speaker</p>
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
            ) : communicators.length === 0 && unassignedSermons.length === 0 ? (
              <Card>
                <CardContent className="pt-8 pb-12 text-center">
                  <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <FolderOpen className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No communicators yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create a folder for each speaker to organize their sermons
                  </p>
                  <Button onClick={() => setNewCommunicatorOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Communicator
                  </Button>
                </CardContent>
              </Card>
            ) : (
              renderFolderView()
            )}
          </>
        ) : (
          renderCommunicatorSermons()
        )}
      </main>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploadComplete={fetchData}
        communicatorId={selectedCommunicator?.id !== "unassigned" ? selectedCommunicator?.id : undefined}
      />

      {/* New Communicator Dialog */}
      <Dialog open={newCommunicatorOpen} onOpenChange={setNewCommunicatorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Communicator</DialogTitle>
            <DialogDescription>
              Create a folder to organize sermons by speaker
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Communicator name"
            value={newCommunicatorName}
            onChange={(e) => setNewCommunicatorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateCommunicator();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCommunicatorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCommunicator} disabled={!newCommunicatorName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Communicator Confirmation */}
      <AlertDialog open={deleteCommunicatorOpen} onOpenChange={setDeleteCommunicatorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the "{communicatorToDelete?.name}" folder. Sermons in this folder will be moved to Unassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCommunicator}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;