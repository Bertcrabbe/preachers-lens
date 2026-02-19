import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Play, Pause, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  onClear: () => void;
  selectedDeviceId?: string | null;
  onRecordingStateChange?: (isRecording: boolean, time: number, stopFn: () => void) => void;
}

export const AudioRecorder = ({ onRecordingComplete, onClear, selectedDeviceId, onRecordingStateChange }: AudioRecorderProps) => {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout>();
  const streamRef = useRef<MediaStream | null>(null);

  // Use a ref-based stop function that can be called from anywhere
  const stopRecordingRef = useRef<() => void>(() => {});
  
  stopRecordingRef.current = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      onRecordingStateChange?.(false, 0, () => {});
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      // Use selected device or fall back to default
      const audioConstraints: MediaTrackConstraints = selectedDeviceId 
        ? { deviceId: { exact: selectedDeviceId } }
        : {};
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        onRecordingComplete(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      // Notify parent of recording state - pass a wrapper that calls the ref
      const stopFn = () => stopRecordingRef.current();
      onRecordingStateChange?.(true, 0, stopFn);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          onRecordingStateChange?.(true, newTime, stopFn);
          return newTime;
        });
      }, 1000);
    } catch (error: any) {
      toast({
        title: "Recording failed",
        description: "Could not access microphone",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    stopRecordingRef.current();
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const clearRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl("");
    setRecordingTime(0);
    setIsPlaying(false);
    onClear();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {!audioBlob ? (
        <div className="flex flex-col items-center gap-4">
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            variant={isRecording ? "destructive" : "default"}
            size="lg"
            className="w-full"
          >
            {isRecording ? (
              <>
                <Square className="mr-2 h-5 w-5" />
                Stop Recording ({formatTime(recordingTime)})
              </>
            ) : (
              <>
                <Mic className="mr-2 h-5 w-5" />
                Start Recording
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm text-muted-foreground">
            ✓ Recorded: {formatTime(recordingTime)}
          </div>
          <Button onClick={clearRecording} variant="ghost" size="sm">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
