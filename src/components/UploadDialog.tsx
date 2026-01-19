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

  // Check if URL is an Apple Podcasts link
  const isApplePodcastsUrl = (urlString: string): boolean => {
    try {
      const parsed = new URL(urlString);
      return parsed.hostname === 'podcasts.apple.com';
    } catch {
      return false;
    }
  };

  const handleUrlUpload = async () => {
    if (!url) return;

    // URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    // Validate hostname - cannot start or end with hyphen
    const hostname = parsedUrl.hostname;
    if (hostname.startsWith('-') || hostname.includes('.-') || hostname.includes('-.')) {
      toast({
        title: "Invalid URL",
        description: "The URL contains an invalid domain name",
        variant: "destructive",
      });
      return;
    }

    // Validate it's http or https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      toast({
        title: "Invalid URL",
        description: "Please enter an HTTP or HTTPS URL",
        variant: "destructive",
      });
      return;
    }

    // Check if it's an Apple Podcasts URL (supported)
    const isApplePodcast = isApplePodcastsUrl(url);

    // Check for streaming service URLs that won't work (excluding Apple Podcasts)
    if (!isApplePodcast) {
      const streamingServices = [
        { pattern: /spotify\.com/i, name: "Spotify" },
        { pattern: /music\.apple\.com/i, name: "Apple Music" },
        { pattern: /youtube\.com|youtu\.be/i, name: "YouTube" },
        { pattern: /soundcloud\.com/i, name: "SoundCloud" },
        { pattern: /podcasts\.google\.com/i, name: "Google Podcasts" },
        { pattern: /deezer\.com/i, name: "Deezer" },
        { pattern: /tidal\.com/i, name: "Tidal" },
      ];
      
      const blockedService = streamingServices.find(s => s.pattern.test(hostname));
      if (blockedService) {
        toast({
          title: "Streaming URL not supported",
          description: `${blockedService.name} links don't provide direct audio access. Please use a direct link to an MP3, WAV, or M4A file.`,
          variant: "destructive",
        });
        return;
      }
    }

    setUploading(true);
    try {
      // Use different endpoint for Apple Podcasts
      const functionName = isApplePodcast ? 'download-podcast-url' : 'download-audio-url';
      
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { url, title: title || undefined }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast({
        title: "Upload successful",
        description: isApplePodcast 
          ? `"${data.episodeTitle || 'Episode'}" is being transcribed`
          : "Your sermon is being transcribed",
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
                Paste a direct audio link (MP3, WAV, M4A) or an Apple Podcasts link
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
