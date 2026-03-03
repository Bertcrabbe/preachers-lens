import { useState, useCallback } from "react";
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
import { Upload, Loader2, Link, Search, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AudioLinkResult {
  url: string;
  name: string;
  potential?: boolean;
}

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
  communicatorId?: string;
}

export const UploadDialog = ({ open, onOpenChange, onUploadComplete, communicatorId }: UploadDialogProps) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "url">("url");
  const [isDragging, setIsDragging] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [foundAudioLinks, setFoundAudioLinks] = useState<AudioLinkResult[]>([]);
  const [showAudioPicker, setShowAudioPicker] = useState(false);

  const validateFile = useCallback((selectedFile: File): boolean => {
    const validTypes = ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/mp4"];
    const maxSize = 300 * 1024 * 1024; // 300MB

    if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(mp3|wav|m4a)$/i)) {
      toast({
        title: "Invalid file type",
        description: "Please upload an MP3, WAV, or M4A file",
        variant: "destructive",
      });
      return false;
    }

    if (selectedFile.size > maxSize) {
      toast({
        title: "File too large",
        description: "Maximum file size is 300MB",
        variant: "destructive",
      });
      return false;
    }

    return true;
  }, [toast]);

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (validateFile(selectedFile)) {
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
      }
      setActiveTab("file");
    }
  }, [title, validateFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

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
          communicator_id: communicatorId || null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      if (sermon) {
        supabase.functions.invoke('transcribe-sermon', {
          body: { sermonId: sermon.id }
        }).catch((err) => {
          console.error('Transcription trigger failed:', err);
        });
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

  const isApplePodcastsUrl = (urlString: string): boolean => {
    try {
      const parsed = new URL(urlString);
      return parsed.hostname === 'podcasts.apple.com';
    } catch {
      return false;
    }
  };

  const isYouTubeUrl = (urlString: string): boolean => {
    try {
      const parsed = new URL(urlString);
      return parsed.hostname === 'youtube.com' || 
             parsed.hostname === 'www.youtube.com' || 
             parsed.hostname === 'youtu.be' ||
             parsed.hostname === 'm.youtube.com';
    } catch {
      return false;
    }
  };

  const isSubsplashUrl = (urlString: string): boolean => {
    try {
      const parsed = new URL(urlString);
      return parsed.hostname.endsWith('subspla.sh') || 
             parsed.hostname.endsWith('subsplash.com');
    } catch {
      return false;
    }
  };

  const scrapeForAudioLinks = async (pageUrl: string) => {
    setScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-audio-links', {
        body: { url: pageUrl }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const allLinks = [...(data.audioLinks || []), ...(data.potentialAudioLinks || [])];
      
      if (allLinks.length > 0) {
        setFoundAudioLinks(allLinks);
        setShowAudioPicker(true);
        if (data.pageTitle && !title) {
          setTitle(data.pageTitle);
        }
        toast({
          title: `Found ${data.audioLinks?.length || 0} audio link(s)`,
          description: "Select the audio file you want to import",
        });
      } else {
        toast({
          title: "No audio files found",
          description: "This page doesn't contain direct links to audio files. Try right-clicking the audio player on the page, copying the audio URL, and pasting it here.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Scrape failed:", error);
      toast({
        title: "Could not scan page",
        description: "Try right-clicking the audio player on the page and copying the audio URL directly.",
        variant: "destructive",
      });
    } finally {
      setScraping(false);
    }
  };

  const handleSelectAudioLink = async (audioUrl: string) => {
    setShowAudioPicker(false);
    setFoundAudioLinks([]);
    setUrl(audioUrl);
    
    // Immediately start downloading the selected audio link
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke('download-audio-url', {
        body: { url: audioUrl, title: title || undefined, communicatorId: communicatorId || undefined }
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

  const handleUrlUpload = async () => {
    if (!url) return;

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

    const hostname = parsedUrl.hostname;
    const labels = hostname.split('.');
    const hasInvalidLabel = labels.some(label => label.startsWith('-') || label.endsWith('-'));
    if (hasInvalidLabel) {
      toast({
        title: "Invalid URL",
        description: "This link contains an invalid domain name. Please check the URL or try copying a different share link.",
        variant: "destructive",
      });
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      toast({
        title: "Invalid URL",
        description: "Please enter an HTTP or HTTPS URL",
        variant: "destructive",
      });
      return;
    }

    const isApplePodcast = isApplePodcastsUrl(url);
    
    const isYouTube = isYouTubeUrl(url);
    if (isYouTube) {
      toast({
        title: "YouTube links not supported",
        description: "Please download the audio using a YouTube to MP3 converter tool (e.g. y2mate.com), then upload the file directly.",
        variant: "destructive",
      });
      return;
    }

    if (isSubsplashUrl(url)) {
      toast({
        title: "Subsplash links not supported",
        description: "Subsplash share links can't be downloaded directly. Please find the sermon's podcast RSS feed or Apple Podcasts link, or download the audio file and upload it here.",
        variant: "destructive",
      });
      return;
    }

    if (!isApplePodcast) {
      const streamingServices = [
        { pattern: /spotify\.com/i, name: "Spotify" },
        { pattern: /music\.apple\.com/i, name: "Apple Music" },
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
      const functionName = isApplePodcast ? 'download-podcast-url' : 'download-audio-url';
      
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { url, title: title || undefined, communicatorId: communicatorId || undefined }
      });

      // Check for webpage detection in either error or data
      const errorMsg = error?.message || '';
      const dataError = data?.error || '';
      const combinedMsg = `${errorMsg} ${dataError}`;
      const isWebpage = combinedMsg.includes("webpage") || combinedMsg.includes("Content-Type: text/html");

      if (isWebpage) {
        setUploading(false);
        toast({
          title: "Scanning page for audio files...",
          description: "That URL is a webpage. Looking for audio links on the page.",
        });
        await scrapeForAudioLinks(url);
        return;
      }

      if (error) throw error;
      if (!data?.success) throw new Error(dataError || "Unknown error");

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
      const msg = error.message || "Unknown error";
      toast({
        title: "Upload failed",
        description: msg,
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
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setShowAudioPicker(false);
        setFoundAudioLinks([]);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-lg">
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

          {showAudioPicker ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Search className="h-4 w-4" />
                Audio files found on page
              </div>
              <ScrollArea className="max-h-60">
                <div className="space-y-2 pr-3">
                  {foundAudioLinks.map((link, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectAudioLink(link.url)}
                      disabled={uploading}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-colors",
                        "hover:bg-accent hover:border-primary/30",
                        "focus:outline-none focus:ring-2 focus:ring-primary/50",
                        link.potential && "opacity-70"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <ExternalLink className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{link.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                          {link.potential && (
                            <p className="text-xs text-muted-foreground/70 mt-1 italic">May not be a direct audio file</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAudioPicker(false);
                  setFoundAudioLinks([]);
                }}
              >
                Back to URL input
              </Button>
            </div>
          ) : (
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
                <div
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className={cn(
                    "relative border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer",
                    isDragging 
                      ? "border-primary bg-primary/5" 
                      : "border-muted-foreground/25 hover:border-muted-foreground/50",
                    file && "border-primary/50 bg-primary/5"
                  )}
                  onClick={() => document.getElementById('file')?.click()}
                >
                  <Input
                    id="file"
                    type="file"
                    accept=".mp3,.wav,.m4a,audio/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center justify-center text-center">
                    <Upload className={cn(
                      "h-8 w-8 mb-2",
                      isDragging ? "text-primary" : "text-muted-foreground"
                    )} />
                    {file ? (
                      <div>
                        <p className="font-medium text-sm">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)}MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium">
                          {isDragging ? "Drop your file here" : "Drag & drop or click to upload"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          MP3, WAV, or M4A (max 300MB)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
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
                  Paste a direct audio link, Apple Podcasts link, or a webpage — we'll try to find the audio
                </p>
              </TabsContent>
            </Tabs>
          )}

          {!showAudioPicker && (
            <Button
              onClick={handleUpload}
              disabled={!canUpload || uploading || scraping}
              className="w-full"
            >
              {scraping ? (
                <>
                  <Search className="mr-2 h-4 w-4 animate-pulse" />
                  Scanning page for audio...
                </>
              ) : uploading ? (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
