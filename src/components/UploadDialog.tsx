import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Link } from "lucide-react";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}

export const UploadDialog = ({ open, onOpenChange, onUploadComplete }: UploadDialogProps) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const validTypes = ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/mp4"];
      const maxSize = 300 * 1024 * 1024; // 300MB

      if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(mp3|wav|m4a)$/i)) {
        toast({
          title: "Invalid file type",
          description: "Please upload an MP3, WAV, or M4A file",
          variant: "destructive",
        });
        return;
      }

      if (selectedFile.size > maxSize) {
        toast({
          title: "File too large",
          description: "Maximum file size is 300MB",
          variant: "destructive",
        });
        return;
      }

      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleFileUpload = async () => {
    if (!file) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("sermons")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: sermon, error: dbError } = await supabase
        .from("sermons")
        .insert({
          user_id: user.id,
          title: title || file.name,
          file_url: fileName,
          file_type: "audio",
          transcription_status: "pending",
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // Trigger transcription via edge function
      if (sermon) {
        const { error: transcribeError } = await supabase.functions.invoke('transcribe-sermon', {
          body: { sermonId: sermon.id }
        });

        if (transcribeError) {
          console.error('Transcription trigger failed:', transcribeError);
        }
      }

      toast({
        title: "Upload successful",
        description: "Your sermon is being transcribed",
      });

      onUploadComplete();
      onOpenChange(false);
      setFile(null);
      setTitle("");
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlUpload = async () => {
    if (!url) return;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke('download-audio-url', {
        body: { url, title: title || undefined }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast({
        title: "Upload successful",
        description: "Your sermon is being transcribed",
      });

      onUploadComplete();
      onOpenChange(false);
      setUrl("");
      setTitle("");
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => {
    if (activeTab === "file") {
      handleFileUpload();
    } else {
      handleUrlUpload();
    }
  };

  const canUpload = activeTab === "file" ? !!file : !!url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Sermon</DialogTitle>
          <DialogDescription>
            Upload an audio file or provide a URL to transcribe
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Sermon Title (optional)</Label>
            <Input
              id="title"
              placeholder="Sunday Service - John 3:16"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "file" | "url")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">
                <Upload className="mr-2 h-4 w-4" />
                File Upload
              </TabsTrigger>
              <TabsTrigger value="url">
                <Link className="mr-2 h-4 w-4" />
                From URL
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="space-y-2">
              <Label htmlFor="file">Audio File</Label>
              <Input
                id="file"
                type="file"
                accept=".mp3,.wav,.m4a,audio/*"
                onChange={handleFileChange}
              />
              {file && (
                <p className="text-sm text-muted-foreground">
                  Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)
                </p>
              )}
            </TabsContent>
            <TabsContent value="url" className="space-y-2">
              <Label htmlFor="url">Audio URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://example.com/sermon.mp3"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Paste a direct link to an MP3, WAV, or M4A file
              </p>
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleUpload}
            disabled={!canUpload || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {activeTab === "url" ? "Downloading..." : "Uploading..."}
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload and Transcribe
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
