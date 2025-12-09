import { Button } from "@/components/ui/button";
import { Square, Mic } from "lucide-react";

interface FloatingRecordingIndicatorProps {
  isRecording: boolean;
  recordingTime: number;
  onStopRecording: () => void;
}

export const FloatingRecordingIndicator = ({
  isRecording,
  recordingTime,
  onStopRecording,
}: FloatingRecordingIndicatorProps) => {
  if (!isRecording) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
      <div className="flex items-center gap-3 bg-destructive text-destructive-foreground px-4 py-3 rounded-full shadow-lg">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-medium">Recording {formatTime(recordingTime)}</span>
        </div>
        <Button
          onClick={onStopRecording}
          variant="secondary"
          size="sm"
          className="rounded-full"
        >
          <Square className="h-4 w-4 mr-1" />
          Stop
        </Button>
      </div>
    </div>
  );
};
