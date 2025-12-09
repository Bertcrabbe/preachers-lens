import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Play, Pause, Trash2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  onClear: () => void;
}

interface AudioDevice {
  deviceId: string;
  label: string;
}

export const AudioRecorder = ({ onRecordingComplete, onClear }: AudioRecorderProps) => {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    loadAudioDevices();
    
    // Listen for device changes (e.g., plugging in a new mic)
    navigator.mediaDevices.addEventListener('devicechange', loadAudioDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadAudioDevices);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const loadAudioDevices = async () => {
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
        }));
      
      setAudioDevices(audioInputs);
      
      // Auto-select preferred device if none selected
      if (!selectedDeviceId && audioInputs.length > 0) {
        const preferredId = await getPreferredMicrophone(audioInputs);
        setSelectedDeviceId(preferredId || audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error loading audio devices:', error);
    }
  };

  const getPreferredMicrophone = (audioInputs: AudioDevice[]): string | undefined => {
    console.log('Available audio inputs:', audioInputs.map(d => ({ label: d.label, deviceId: d.deviceId })));
    
    // Priority 1: Look for Shure microphone (case-insensitive)
    const shureMic = audioInputs.find(device => 
      device.label.toLowerCase().includes('shure')
    );
    
    if (shureMic) {
      console.log('Using Shure microphone:', shureMic.label);
      return shureMic.deviceId;
    }
    
    // Priority 2: Look for built-in laptop microphone (avoid phone/external devices)
    const builtInMic = audioInputs.find(device => {
      const label = device.label.toLowerCase();
      return (
        label.includes('built-in') ||
        label.includes('builtin') ||
        label.includes('internal') ||
        label.includes('macbook') ||
        label.includes('laptop') ||
        label.includes('realtek') ||
        label.includes('integrated')
      );
    });
    
    if (builtInMic) {
      console.log('Using built-in microphone:', builtInMic.label);
      return builtInMic.deviceId;
    }
    
    // Priority 3: Avoid phone/mobile devices, pick first non-phone device
    const nonPhoneMic = audioInputs.find(device => {
      const label = device.label.toLowerCase();
      return !(
        label.includes('iphone') ||
        label.includes('android') ||
        label.includes('phone') ||
        label.includes('bluetooth') ||
        label.includes('airpods') ||
        label.includes('wireless')
      );
    });
    
    if (nonPhoneMic) {
      console.log('Using non-phone microphone:', nonPhoneMic.label);
      return nonPhoneMic.deviceId;
    }
    
    console.log('No preferred mic found, using system default');
    return undefined;
  };

  const startRecording = async () => {
    try {
      // Use selected device or fall back to default
      const deviceIdToUse = selectedDeviceId;
      
      const audioConstraints: MediaTrackConstraints = deviceIdToUse 
        ? { deviceId: { exact: deviceIdToUse } }
        : {};
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
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
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
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

  const getSelectedDeviceLabel = () => {
    const device = audioDevices.find(d => d.deviceId === selectedDeviceId);
    return device?.label || 'Select Microphone';
  };

  return (
    <div className="space-y-4">
      {/* Microphone Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">Microphone</label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isRecording}>
            <Button 
              variant="outline" 
              className="w-full justify-between text-left font-normal"
              disabled={isRecording}
            >
              <span className="truncate">{getSelectedDeviceLabel()}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[300px] bg-popover z-50" align="start">
            {audioDevices.map((device) => (
              <DropdownMenuItem
                key={device.deviceId}
                onClick={() => setSelectedDeviceId(device.deviceId)}
                className={selectedDeviceId === device.deviceId ? "bg-accent" : ""}
              >
                <Mic className="mr-2 h-4 w-4" />
                <span className="truncate">{device.label}</span>
              </DropdownMenuItem>
            ))}
            {audioDevices.length === 0 && (
              <DropdownMenuItem disabled>
                No microphones found
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
        <div className="space-y-3">
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            <Button onClick={togglePlayback} variant="outline" size="sm">
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <div className="flex-1 text-sm text-muted-foreground">
              Recording: {formatTime(recordingTime)}
            </div>
            <Button onClick={clearRecording} variant="ghost" size="sm">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
