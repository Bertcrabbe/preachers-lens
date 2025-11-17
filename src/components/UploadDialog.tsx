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
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2 } from "lucide-react";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}

export const UploadDialog = ({ open, onOpenChange, onUploadComplete }: UploadDialogProps) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);

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

  const handleUpload = async () => {
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

      const { data: { publicUrl } } = supabase.storage
        .from("sermons")
        .getPublicUrl(fileName);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Sermon</DialogTitle>
          <DialogDescription>
            Upload an audio file (MP3, WAV, or M4A) to transcribe
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Sermon Title</Label>
            <Input
              id="title"
              placeholder="Sunday Service - John 3:16"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
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
          </div>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
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
