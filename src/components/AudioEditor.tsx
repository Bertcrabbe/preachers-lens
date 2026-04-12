import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Scissors,
  Trash2,
  Undo2,
  Save,
  Play,
  Pause,
  X,
  AlertTriangle,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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

interface SplitPoint {
  id: string;
  timeMs: number;
}

interface Segment {
  id: string;
  startMs: number;
  endMs: number;
  deleted: boolean;
}

interface AudioEditorProps {
  audioUrl: string;
  fileUrl: string; // Storage path
  sermonId: string;
  durationMs: number;
  onClose: () => void;
  onSave: () => void;
}

export const AudioEditor = ({
  audioUrl,
  fileUrl,
  sermonId,
  durationMs,
  onClose,
  onSave,
}: AudioEditorProps) => {
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [splitPoints, setSplitPoints] = useState<SplitPoint[]>([]);
  const [segments, setSegments] = useState<Segment[]>([
    { id: "initial", startMs: 0, endMs: durationMs, deleted: false },
  ]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(true);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [splitMode, setSplitMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const zoomLevels = [1, 2, 4, 6, 8, 10];

  // Zoom to cursor position
  const zoomTo = useCallback((newZoom: number) => {
    const container = containerRef.current;
    if (!container) {
      setZoom(newZoom);
      return;
    }
    const oldZoom = zoom;
    const scrollCenter = container.scrollLeft + container.clientWidth / 2;
    const scrollRatio = scrollCenter / (container.clientWidth * oldZoom);
    setZoom(newZoom);
    requestAnimationFrame(() => {
      const newScrollCenter = scrollRatio * container.clientWidth * newZoom;
      container.scrollLeft = newScrollCenter - container.clientWidth / 2;
    });
  }, [zoom]);

  // Keyboard zoom shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        zoomTo(Math.min(10, zoom * 2));
      } else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        zoomTo(Math.max(1, zoom / 2));
      } else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        zoomTo(1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoom, zoomTo]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(10, Math.max(1, zoom * (direction > 0 ? 1.5 : 1 / 1.5)));
    // Zoom toward cursor
    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const scrollPos = container.scrollLeft + cursorX;
    const scrollRatio = scrollPos / (container.clientWidth * zoom);
    setZoom(newZoom);
    requestAnimationFrame(() => {
      const newScrollPos = scrollRatio * container.clientWidth * newZoom;
      container.scrollLeft = newScrollPos - cursorX;
    });
  }, [zoom]);
  // Generate waveform on mount
  useEffect(() => {
    generateWaveform();
  }, [audioUrl]);

  const generateWaveform = async () => {
    setWaveformLoading(true);
    setWaveformError(null);
    
    try {
      console.log("Generating waveform from:", audioUrl);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const response = await fetch(audioUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      console.log("Audio buffer size:", arrayBuffer.byteLength);
      
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log("Audio decoded, duration:", audioBuffer.duration);

      const rawData = audioBuffer.getChannelData(0);
      const samples = 4000;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData: number[] = [];

      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }

      const max = Math.max(...filteredData);
      setWaveformData(filteredData.map((n) => n / max));
      await audioContext.close();
      console.log("Waveform generated successfully");
    } catch (error: any) {
      console.error("Error generating waveform:", error);
      setWaveformError(error.message || "Failed to generate waveform");
    } finally {
      setWaveformLoading(false);
    }
  };

  const recalculateSegments = useCallback((points: SplitPoint[]) => {
    const sortedPoints = [...points].sort((a, b) => a.timeMs - b.timeMs);
    const newSegments: Segment[] = [];
    let start = 0;

    for (const point of sortedPoints) {
      if (point.timeMs > start) {
        newSegments.push({
          id: `seg-${start}-${point.timeMs}`,
          startMs: start,
          endMs: point.timeMs,
          deleted: segments.find(
            (s) => s.startMs <= start && s.endMs >= point.timeMs
          )?.deleted || false,
        });
      }
      start = point.timeMs;
    }

    if (start < durationMs) {
      newSegments.push({
        id: `seg-${start}-${durationMs}`,
        startMs: start,
        endMs: durationMs,
        deleted: segments.find(
          (s) => s.startMs <= start && s.endMs >= durationMs
        )?.deleted || false,
      });
    }

    setSegments(newSegments);
  }, [durationMs, segments]);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !splitMode) return;

    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const totalWidth = containerRef.current.scrollWidth;
    const clickPercent = clickX / totalWidth;
    const timeMs = clickPercent * durationMs;

    // Add split point
    const newPoint: SplitPoint = {
      id: `split-${Date.now()}`,
      timeMs,
    };

    const newPoints = [...splitPoints, newPoint];
    setSplitPoints(newPoints);
    recalculateSegments(newPoints);
    setSplitMode(false);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const hoverX = e.clientX - rect.left + scrollLeft;
    const totalWidth = containerRef.current.scrollWidth;
    const hoverPercent = hoverX / totalWidth;
    setHoverTime(hoverPercent * durationMs);
  };

  const handleSegmentClick = (segmentId: string, e: React.MouseEvent) => {
    if (splitMode) return; // Let click bubble up to handleTimelineClick
    e.stopPropagation();
    setSelectedSegmentId(selectedSegmentId === segmentId ? null : segmentId);
  };

  const deleteSelectedSegment = () => {
    if (!selectedSegmentId) return;

    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === selectedSegmentId ? { ...seg, deleted: true } : seg
      )
    );
    setSelectedSegmentId(null);
  };

  const restoreSegment = (segmentId: string) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId ? { ...seg, deleted: false } : seg
      )
    );
  };

  const undoAllSplits = () => {
    setSplitPoints([]);
    setSegments([{ id: "initial", startMs: 0, endMs: durationMs, deleted: false }]);
    setSelectedSegmentId(null);
  };

  const seekToTime = (timeMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = timeMs / 1000;
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSave = async () => {
    const deletedSegments = segments.filter((s) => s.deleted);
    if (deletedSegments.length === 0) {
      toast({
        title: "No changes",
        description: "No segments have been marked for deletion",
      });
      return;
    }

    setConfirmDialogOpen(true);
  };

  const performSave = async () => {
    setSaving(true);
    setConfirmDialogOpen(false);

    try {
      // Fetch and decode audio
      const audioContext = new AudioContext({ sampleRate: 44100 });
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const sourceBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get kept segments
      const keptSegments = segments.filter((s) => !s.deleted);
      if (keptSegments.length === 0) {
        throw new Error("Cannot delete entire audio file");
      }

      // Calculate new duration
      const newDuration = keptSegments.reduce(
        (sum, seg) => sum + (seg.endMs - seg.startMs) / 1000,
        0
      );

      // Create offline context
      const offlineContext = new OfflineAudioContext(
        sourceBuffer.numberOfChannels,
        Math.ceil(newDuration * 44100),
        44100
      );

      let outputTime = 0;

      // Copy kept segments
      for (const segment of keptSegments) {
        const startSec = segment.startMs / 1000;
        const durationSec = (segment.endMs - segment.startMs) / 1000;

        const source = offlineContext.createBufferSource();
        source.buffer = sourceBuffer;
        source.connect(offlineContext.destination);
        source.start(outputTime, startSec, durationSec);
        outputTime += durationSec;
      }

      // Render
      const renderedBuffer = await offlineContext.startRendering();

      // Encode to WAV
      const wavBlob = audioBufferToWav(renderedBuffer);

      // Upload to storage (replace existing file)
      const { error: uploadError } = await supabase.storage
        .from("sermons")
        .update(fileUrl, wavBlob, {
          contentType: "audio/wav",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Update sermon duration
      await supabase
        .from("sermons")
        .update({ duration_seconds: Math.floor(newDuration) })
        .eq("id", sermonId);

      // --- Recalibrate transcript timestamps ---
      // Build a mapping: for each kept segment, calculate its new offset
      const sortedKept = [...keptSegments].sort((a, b) => a.startMs - b.startMs);
      let cumulativeMs = 0;
      const timeMap = sortedKept.map((seg) => {
        const entry = { oldStart: seg.startMs, oldEnd: seg.endMs, newStart: cumulativeMs };
        cumulativeMs += seg.endMs - seg.startMs;
        return entry;
      });

      // Helper: convert old time to new time, returns null if in a deleted region
      const remapTime = (oldMs: number): number | null => {
        for (const m of timeMap) {
          if (oldMs >= m.oldStart && oldMs <= m.oldEnd) {
            return m.newStart + (oldMs - m.oldStart);
          }
        }
        return null; // falls in a deleted segment
      };

      // Fetch all sentences for this sermon
      const { data: sentences, error: fetchErr } = await supabase
        .from("sermon_sentences")
        .select("id, start_time_ms, end_time_ms, order_index")
        .eq("sermon_id", sermonId)
        .order("order_index", { ascending: true });

      if (fetchErr) throw fetchErr;

      if (sentences && sentences.length > 0) {
        const toDelete: string[] = [];
        const toUpdate: { id: string; start_time_ms: number; end_time_ms: number; order_index: number }[] = [];
        let newIndex = 0;

        for (const sent of sentences) {
          const newStart = remapTime(sent.start_time_ms);
          const newEnd = remapTime(sent.end_time_ms);

          if (newStart === null && newEnd === null) {
            // Entire sentence is in a deleted region
            toDelete.push(sent.id);
          } else {
            // Clamp to valid range
            const clampedStart = newStart !== null ? newStart : 0;
            const clampedEnd = newEnd !== null ? newEnd : Math.round(newDuration * 1000);
            toUpdate.push({
              id: sent.id,
              start_time_ms: Math.round(clampedStart),
              end_time_ms: Math.round(clampedEnd),
              order_index: newIndex,
            });
            newIndex++;
          }
        }

        // Delete sentences in deleted regions
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from("sermon_sentences")
            .delete()
            .in("id", toDelete);
          if (delErr) console.error("Error deleting sentences:", delErr);
        }

        // Update remaining sentences with new timestamps
        for (const upd of toUpdate) {
          const { error: updErr } = await supabase
            .from("sermon_sentences")
            .update({
              start_time_ms: upd.start_time_ms,
              end_time_ms: upd.end_time_ms,
              order_index: upd.order_index,
            })
            .eq("id", upd.id);
          if (updErr) console.error("Error updating sentence:", updErr);
        }

        console.log(`Recalibrated ${toUpdate.length} sentences, removed ${toDelete.length}`);
      }

      await audioContext.close();

      toast({
        title: "Audio saved",
        description: `Removed ${segments.filter((s) => s.deleted).length} segment(s). New duration: ${formatTime(newDuration * 1000)}. Transcript timestamps recalibrated.`,
      });

      onSave();
    } catch (error: any) {
      console.error("Save error:", error);
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Simple WAV encoder
  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = buffer.length * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    // Interleave channels
    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  };

  const deletedCount = segments.filter((s) => s.deleted).length;
  const deletedDuration = segments
    .filter((s) => s.deleted)
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

  return (
    <Card className="p-4 space-y-4 bg-card border-2 border-primary/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Audio Editor</h3>
          {deletedCount > 0 && (
            <span className="text-sm text-destructive">
              ({deletedCount} segment{deletedCount > 1 ? "s" : ""} marked for deletion, {formatTime(deletedDuration)})
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Instructions */}
      <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
        <p>
          <strong>Split:</strong> Click the scissors button, then click on the waveform to add a split point.
        </p>
        <p>
          <strong>Delete:</strong> Click a segment to select it, then click the trash button to mark it for deletion.
        </p>
        <p>
          <strong>Save:</strong> Click save to permanently remove deleted segments and re-upload the audio.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={splitMode ? "default" : "outline"}
          size="sm"
          onClick={() => setSplitMode(!splitMode)}
        >
          <Scissors className="h-4 w-4 mr-2" />
          {splitMode ? "Click waveform to split" : "Split"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={deleteSelectedSegment}
          disabled={!selectedSegmentId}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Segment
        </Button>

        <Button variant="outline" size="sm" onClick={undoAllSplits}>
          <Undo2 className="h-4 w-4 mr-2" />
          Reset
        </Button>

        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => zoomTo(Math.max(1, zoom / 2))}
            title="Zoom out (Ctrl+-)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Slider
              min={0}
              max={zoomLevels.length - 1}
              step={1}
              value={[zoomLevels.findIndex((z) => z >= zoom) === -1 ? zoomLevels.length - 1 : zoomLevels.findIndex((z) => z >= zoom)]}
              onValueChange={(val) => zoomTo(zoomLevels[val[0]])}
              className="w-24"
            />
            <span className="text-sm w-12 text-center font-mono">{zoom}x</span>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => zoomTo(Math.min(10, zoom * 2))}
            title="Zoom in (Ctrl++)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => zoomTo(1)}
            className="text-xs"
            title="Reset zoom (Ctrl+0)"
          >
            Reset
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={togglePlayPause}>
          {playing ? (
            <Pause className="h-4 w-4 mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {playing ? "Pause" : "Play"}
        </Button>

        <Button
          onClick={handleSave}
          disabled={deletedCount === 0 || saving}
          className="bg-primary"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>

      {/* Audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={() => setCurrentTime((audioRef.current?.currentTime || 0) * 1000)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Waveform Timeline */}
      <div
        ref={containerRef}
        className={cn(
          "relative h-32 bg-secondary/60 rounded-lg overflow-x-auto border-2 transition-all",
          splitMode ? "border-primary cursor-crosshair" : "border-border cursor-pointer"
        )}
        onClick={handleTimelineClick}
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={() => setHoverTime(null)}
        onWheel={handleWheel}
        style={{ width: "100%" }}
      >
        <div
          className="relative h-full"
          style={{ width: `${100 * zoom}%`, minWidth: "100%" }}
        >
          {/* Loading state */}
          {waveformLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Generating waveform...</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {waveformError && !waveformLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span>{waveformError}</span>
              </div>
            </div>
          )}

          {/* Waveform bars */}
          {!waveformLoading && !waveformError && waveformData.map((amplitude, index) => {
            const barPercent = (index / waveformData.length) * 100;
            const barTimeMs = (index / waveformData.length) * durationMs;
            const segment = segments.find(
              (s) => barTimeMs >= s.startMs && barTimeMs < s.endMs
            );
            const isDeleted = segment?.deleted;
            const isSelected = segment?.id === selectedSegmentId;

            return (
              <div
                key={index}
                className={cn(
                  "absolute bottom-0 rounded-t-sm transition-all",
                  isDeleted
                    ? "bg-destructive/30"
                    : isSelected
                    ? "bg-primary"
                    : "bg-primary/60"
                )}
                style={{
                  left: `${barPercent}%`,
                  width: `${100 / waveformData.length}%`,
                  height: `${amplitude * 100}%`,
                  minHeight: "4px",
                }}
              />
            );
          })}

          {/* Segment overlays */}
          {segments.map((segment) => {
            const left = (segment.startMs / durationMs) * 100;
            const width = ((segment.endMs - segment.startMs) / durationMs) * 100;

            return (
              <div
                key={segment.id}
                className={cn(
                  "absolute top-0 bottom-0 transition-all border-l border-r",
                  segment.deleted
                    ? "bg-destructive/20 border-destructive"
                    : segment.id === selectedSegmentId
                    ? "bg-primary/10 border-primary"
                    : "border-transparent hover:bg-primary/5"
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={(e) => handleSegmentClick(segment.id, e)}
              >
                {segment.deleted && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="bg-background/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        restoreSegment(segment.id);
                      }}
                    >
                      <Undo2 className="h-3 w-3 mr-1" />
                      Restore
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Split point markers */}
          {splitPoints.map((point) => (
            <div
              key={point.id}
              className="absolute top-0 bottom-0 w-1 bg-amber-500 z-10"
              style={{ left: `${(point.timeMs / durationMs) * 100}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-500 rounded-full" />
            </div>
          ))}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground z-20"
            style={{ left: `${(currentTime / durationMs) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-foreground rounded-full" />
          </div>

          {/* Hover indicator - always show timestamp on hover */}
          {hoverTime !== null && (
            <div
              className={cn(
                "absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none",
                splitMode ? "bg-primary/50" : "bg-foreground/30"
              )}
              style={{ left: `${(hoverTime / durationMs) * 100}%` }}
            >
              <div className={cn(
                "absolute -top-6 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded whitespace-nowrap",
                splitMode ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
              )}>
                {formatTime(hoverTime)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Time display */}
      <div className="flex justify-between text-sm font-mono">
        <span>{formatTime(currentTime)}</span>
        <span className="text-muted-foreground">{formatTime(durationMs)}</span>
      </div>

      {/* Segment list */}
      {segments.length > 1 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Segments</h4>
          <div className="flex flex-wrap gap-2">
            {segments.map((segment, idx) => (
              <Button
                key={segment.id}
                variant={segment.deleted ? "destructive" : segment.id === selectedSegmentId ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectedSegmentId(segment.id);
                  seekToTime(segment.startMs);
                }}
                className="text-xs"
              >
                {idx + 1}. {formatTime(segment.startMs)} - {formatTime(segment.endMs)}
                {segment.deleted && " (deleted)"}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently delete audio?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deletedCount} segment(s) ({formatTime(deletedDuration)}) 
              from the audio file. This action cannot be undone.
              <br /><br />
              <strong>Note:</strong> The transcription will remain but may no longer sync 
              with the edited audio timestamps.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performSave} className="bg-destructive">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
