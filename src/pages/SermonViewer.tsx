import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useMicrophoneSelector } from "@/hooks/useMicrophoneSelector";
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
  Sparkles,
  RotateCcw,
  Mic,
  ChevronDown,
  Trash2,
  Pencil,
  Check,
  Scissors,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AudioEditor } from "@/components/AudioEditor";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AudioRecorder } from "@/components/AudioRecorder";
import { FloatingRecordingIndicator } from "@/components/FloatingRecordingIndicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { combineAudioFiles } from "@/utils/audioCombiner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import Sparkline from "@/components/Sparkline";
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

interface Rule {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface Comment {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  comment_text: string;
  created_at: string;
  rule_id?: string | null;
  audio_url?: string | null;
  evaluation_rules?: Rule;
}

const SermonViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { audioDevices, selectedDeviceId, setSelectedDeviceId, getSelectedDeviceLabel } = useMicrophoneSelector();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"sentence" | "paragraph">("paragraph");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number; end: number } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [evaluationDialogOpen, setEvaluationDialogOpen] = useState(false);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [commentType, setCommentType] = useState<"text" | "audio">("audio");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [combiningAudio, setCombiningAudio] = useState(false);
  const [combineProgress, setCombineProgress] = useState(0);
  const [combineStatus, setCombineStatus] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string>("");
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewingParagraph, setPreviewingParagraph] = useState<number | null>(null);
  const [showFastSpeech, setShowFastSpeech] = useState(false);
  const [showVerbalPauses, setShowVerbalPauses] = useState(false);
  const [showSlowSpeech, setShowSlowSpeech] = useState(false);
  const [showVolumeChanges, setShowVolumeChanges] = useState(false);
  const [showInsiderLanguage, setShowInsiderLanguage] = useState(false);
  const [showSilentPauses, setShowSilentPauses] = useState(false);
  const [visibleFillerWords, setVisibleFillerWords] = useState<Set<string>>(new Set());
  const [visibleInsiderTerms, setVisibleInsiderTerms] = useState<Set<string>>(new Set());
  const [fastSpeechThreshold, setFastSpeechThreshold] = useState(1.2);
  const [slowSpeechThreshold, setSlowSpeechThreshold] = useState(0.75);
  const [volumeChangeThreshold, setVolumeChangeThreshold] = useState(1.0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [commentSummary, setCommentSummary] = useState<{
    summary: string;
    bulletPoints: string[];
  } | null>(null);
  const [viewStart, setViewStart] = useState(0); // percentage of audio (0-100)
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [scriptureRefs, setScriptureRefs] = useState<{
    references: Array<{ reference: string; context: string; verse_count?: number; quoted_sentences?: string[] }>;
    total_count: number;
    total_verses?: number;
    scripture_sentence_indices?: number[];
  } | null>(null);
  const [loadingScriptures, setLoadingScriptures] = useState(false);
  const [showScriptureRefs, setShowScriptureRefs] = useState(false);
  const [confusingPhrases, setConfusingPhrases] = useState<{
    phrases: Array<{ sentence_index: number; phrase: string; reason: string; suggestion: string; severity: string; start_time_ms: number; end_time_ms: number; sentence_text: string }>;
    total_count: number;
    accessibility_score: number;
  } | null>(null);
  const [loadingConfusing, setLoadingConfusing] = useState(false);
  const [showConfusingPhrases, setShowConfusingPhrases] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [congregationQuestionIndices, setCongregationQuestionIndices] = useState<Set<number> | null>(null);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [previewWithComments, setPreviewWithComments] = useState(true);
  const [playingCommentId, setPlayingCommentId] = useState<string | null>(null);
  const commentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [commentSignedUrls, setCommentSignedUrls] = useState<Record<string, string>>({});
  const [playedCommentIds, setPlayedCommentIds] = useState<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);
  const [wpmChartClockActive, setWpmChartClockActive] = useState(false);
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const dragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const [volumeChartClockActive, setVolumeChartClockActive] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isAutoScrollingRef = useRef(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sermonVolume, setSermonVolume] = useState(0.75);
  const [commentVolume, setCommentVolume] = useState(0.75);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [floatingRecording, setFloatingRecording] = useState<{
    isRecording: boolean;
    time: number;
    stopFn: (() => void) | null;
  }>({ isRecording: false, time: 0, stopFn: null });
  const [showAudioEditor, setShowAudioEditor] = useState(false);
  const [illustrationData, setIllustrationData] = useState<{
    elements: Array<{ type: string; summary: string; excerpt: string }>;
    total_count: number;
    illustration_score: number;
    breakdown: { stories: number; humor: number; illustrations: number; audience_interactions: number };
  } | null>(null);
  const [loadingIllustrations, setLoadingIllustrations] = useState(false);
  const [engagementExpanded, setEngagementExpanded] = useState(false);
  
  useEffect(() => {
    checkAuth();
    if (id) {
      fetchSermon();
      fetchSentences();
      fetchComments();
      fetchRules();
      fetchScriptureReferences();
      fetchCongregationQuestions();
    }
  }, [id]);

  // Auto-run illustration detection when sentences are loaded
  useEffect(() => {
    if (sentences.length > 0 && !illustrationData && !loadingIllustrations) {
      fetchIllustrations();
    }
  }, [sentences]);

  // Auto-run visitor confusion detection when sentences are loaded
  useEffect(() => {
    if (sentences.length > 0 && !confusingPhrases && !loadingConfusing) {
      fetchConfusingPhrases();
    }
  }, [sentences]);

  // Persist metrics to sermon_metrics table for trends tracking
  useEffect(() => {
    const persistMetrics = async () => {
      if (!id || sentences.length === 0) return;
      if (loadingIllustrations || loadingQuestions) return;
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const totalWords = sentences.reduce((sum: number, s: any) => sum + s.sentence_text.split(/\s+/).filter(Boolean).length, 0);
        const totalDurationMs = sentences.reduce((sum: number, s: any) => sum + (s.end_time_ms - s.start_time_ms), 0);
        const wpm = totalDurationMs > 0 ? Math.round(totalWords / (totalDurationMs / 60000)) : null;

        const congQuestions = sentences.filter((s: any, idx: number) => {
          if (!s.sentence_text.trim().endsWith('?')) return false;
          if (congregationQuestionIndices && !congregationQuestionIndices.has(idx)) return false;
          return true;
        }).length;

        const engagement = getEngagementScore().total;
        const illScore = illustrationData?.illustration_score ?? null;

        await supabase.from("sermon_metrics" as any).upsert({
          sermon_id: id,
          user_id: user.id,
          engagement_score: engagement,
          illustration_score: illScore,
          congregation_questions: congQuestions,
          wpm,
          word_count: totalWords,
          updated_at: new Date().toISOString(),
        }, { onConflict: "sermon_id" });
      } catch (err) {
        console.error("Failed to persist metrics:", err);
      }
    };
    persistMetrics();
  }, [id, sentences, illustrationData, loadingIllustrations, congregationQuestionIndices, loadingQuestions]);

  useEffect(() => {
    if (audioUrl) {
      generateWaveform(audioUrl);
    }
  }, [audioUrl]);

  // Reset played comments when preview mode is toggled
  useEffect(() => {
    if (previewWithComments) {
      // Reset all played comments when enabling preview mode
      setPlayedCommentIds(new Set());
      lastTimeRef.current = audioRef.current?.currentTime ? audioRef.current.currentTime * 1000 : 0;
    }
  }, [previewWithComments]);

  // Apply playback rate to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Apply sermon volume to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = sermonVolume;
    }
  }, [sermonVolume]);

  // Apply comment volume to comment audio element
  useEffect(() => {
    if (commentAudioRef.current) {
      commentAudioRef.current.volume = commentVolume;
    }
  }, [commentVolume, playingCommentId]);

  // Auto-scroll transcript to keep active paragraph as second from top
  useEffect(() => {
    if (!autoScrollEnabled || !playing || viewMode !== "paragraph") return;
    
    const paragraphs = groupIntoParagraphs(sentences);
    const activeIdx = paragraphs.findIndex(p => isCurrentParagraph(p));
    if (activeIdx === -1) return;
    
    const el = paragraphRefs.current[activeIdx];
    if (!el || !transcriptContainerRef.current) return;
    
    // Use getBoundingClientRect to account for parallax 3D transforms
    const container = transcriptContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const scrollOffset = elRect.top - containerRect.top + container.scrollTop;
    
    // Get the height of the first paragraph to use as offset
    const firstEl = paragraphRefs.current[activeIdx > 0 ? activeIdx - 1 : 0];
    const offset = firstEl ? firstEl.getBoundingClientRect().height + 16 : 80;
    
    const targetScrollTop = scrollOffset - offset;
    const currentScroll = container.scrollTop;
    
    // Only scroll if we're not already close
    if (Math.abs(targetScrollTop - currentScroll) > 50) {
      isAutoScrollingRef.current = true;
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      setTimeout(() => { isAutoScrollingRef.current = false; }, 500);
      setUserScrolledAway(false);
    }
  }, [currentTime, autoScrollEnabled, playing, viewMode, sentences]);

  // Detect user scroll to show "return" button
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      if (isAutoScrollingRef.current) return;
      
      // User is manually scrolling - check if active paragraph is visible
      const paragraphs = groupIntoParagraphs(sentences);
      const activeIdx = paragraphs.findIndex(p => isCurrentParagraph(p));
      if (activeIdx === -1) return;
      
      const el = paragraphRefs.current[activeIdx];
      if (!el) return;
      
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      
      const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
      setUserScrolledAway(!isVisible);
      if (!isVisible) {
        setAutoScrollEnabled(false);
      }
    };
    
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [sentences, currentTime]);

  // Parallax depth effect for transcript paragraphs
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    const updateDepth = () => {
      const containerRect = container.getBoundingClientRect();
      const containerHeight = containerRect.height;
      
      paragraphRefs.current.forEach(el => {
        if (!el) return;
        const elRect = el.getBoundingClientRect();
        const elCenter = elRect.top + elRect.height / 2 - containerRect.top;
        const ratio = elCenter / containerHeight; // 0 = top, 1 = bottom
        
        let depth: string;
        if (ratio < 0.1 || ratio > 0.9) {
          depth = "far";
        } else if (ratio < 0.25 || ratio > 0.75) {
          depth = "mid";
        } else if (ratio < 0.4 || ratio > 0.6) {
          depth = "near";
        } else {
          depth = "focus";
        }
        el.setAttribute("data-depth", depth);
      });
    };

    updateDepth();
    container.addEventListener("scroll", updateDepth, { passive: true });
    return () => container.removeEventListener("scroll", updateDepth);
  }, [sentences]);

  const scrollToActiveParagraph = () => {
    const paragraphs = groupIntoParagraphs(sentences);
    const activeIdx = paragraphs.findIndex(p => isCurrentParagraph(p));
    if (activeIdx === -1) return;
    
    const el = paragraphRefs.current[activeIdx];
    if (!el || !transcriptContainerRef.current) return;
    
    const container = transcriptContainerRef.current;

    // First, scroll the page so the transcript container is visible
    container.scrollIntoView({ behavior: "smooth", block: "start" });

    // Use getBoundingClientRect to account for parallax 3D transforms
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const scrollOffset = elRect.top - containerRect.top + container.scrollTop;
    
    const firstEl = paragraphRefs.current[activeIdx > 0 ? activeIdx - 1 : 0];
    const offset = firstEl ? firstEl.getBoundingClientRect().height + 16 : 80;
    
    isAutoScrollingRef.current = true;
    // Use a short delay so the page scroll completes first
    setTimeout(() => {
      container.scrollTo({ top: scrollOffset - offset, behavior: "smooth" });
      setTimeout(() => { isAutoScrollingRef.current = false; }, 500);
    }, 300);
    setAutoScrollEnabled(true);
    setUserScrolledAway(false);
  };

  // Keyboard shortcuts for audio player (works for both sermon and comment audio)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const sermonAudio = audioRef.current;
      const commentAudio = commentAudioRef.current;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          // If a comment is currently playing, control comment audio only
          if (playingCommentId) {
            if (commentAudio) {
              if (commentAudio.paused) {
                commentAudio.play().catch(() => {});
              } else {
                commentAudio.pause();
              }
            }
            // Don't fall through to sermon audio when comment is playing
            return;
          }
          // Otherwise control sermon audio
          if (sermonAudio) {
            if (playing) {
              sermonAudio.pause();
            } else {
              sermonAudio.play().catch(() => {});
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          // If comment is playing, seek within comment
          if (commentAudio && playingCommentId) {
            commentAudio.currentTime = Math.max(0, commentAudio.currentTime - 5);
          } else if (sermonAudio) {
            sermonAudio.currentTime = Math.max(0, sermonAudio.currentTime - 5);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          // If comment is playing, seek within comment
          if (commentAudio && playingCommentId) {
            commentAudio.currentTime = Math.min(commentAudio.duration || 0, commentAudio.currentTime + 5);
          } else if (sermonAudio) {
            sermonAudio.currentTime = Math.min(sermonAudio.duration || 0, sermonAudio.currentTime + 5);
          }
          break;
        case "KeyC":
          // Add comment at current timestamp when audio is paused
          if (!playing && !playingCommentId && audioUrl && currentTime > 0) {
            e.preventDefault();
            const currentSentence = sentences.find(
              s => currentTime >= s.start_time_ms && currentTime <= s.end_time_ms
            );
            const timeMs = currentSentence ? currentSentence.start_time_ms : Math.round(currentTime);
            const endMs = currentSentence ? currentSentence.end_time_ms : Math.round(currentTime) + 1000;
            setSelectedTimeRange({ start: timeMs, end: endMs });
            setCommentDialogOpen(true);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playing, playingCommentId, audioUrl, currentTime, sentences]);

  // Calculate time since last comment in audio timeline
  const timeSinceLastCommentInAudio = (() => {
    if (comments.length === 0) return null;
    
    // currentTime is already in milliseconds
    const currentTimeMs = currentTime;
    
    // Find comments that have started before or at the current playback position
    const pastComments = comments.filter(c => c.start_time_ms <= currentTimeMs);
    
    if (pastComments.length === 0) return null;
    
    // Get the most recent comment before current position (by start time)
    const lastComment = pastComments.reduce((latest, comment) => 
      comment.start_time_ms > latest.start_time_ms ? comment : latest
    , pastComments[0]);
    
    // Return time elapsed in seconds since that comment started
    return Math.floor((currentTimeMs - lastComment.start_time_ms) / 1000);
  })();

  const generateWaveform = async (url: string) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0);
      const samples = 2000; // Number of bars in waveform - high detail
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      
      // Normalize the data
      const max = Math.max(...filteredData);
      const normalizedData = filteredData.map(n => n / max);
      
      setWaveformData(normalizedData);
    } catch (error) {
      console.error("Error generating waveform:", error);
    }
  };

  const paragraphHasPeak = (paragraph: Sentence[]): boolean => {
    if (!sermon?.duration_seconds || waveformData.length === 0) return false;
    
    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    const startTime = firstSentence.start_time_ms;
    const endTime = lastSentence.end_time_ms;
    const totalDuration = sermon.duration_seconds * 1000;
    
    // Calculate baseline average volume for entire sermon
    const baselineAverage = waveformData.reduce((sum, amp) => sum + amp, 0) / waveformData.length;
    
    // Map paragraph time range to waveform indices
    const startIdx = Math.floor((startTime / totalDuration) * waveformData.length);
    const endIdx = Math.ceil((endTime / totalDuration) * waveformData.length);
    
    // Calculate average amplitude for this paragraph
    const paragraphAmplitudes = waveformData.slice(startIdx, endIdx);
    const paragraphAverage = paragraphAmplitudes.reduce((sum, amp) => sum + amp, 0) / paragraphAmplitudes.length;
    
    // Peak (quiet section) is less than 67% of baseline volume
    return paragraphAverage < (baselineAverage * 0.67);
  };

  const hasSignificantVolumeChange = (paragraph: Sentence[], threshold: number): 'increase' | 'decrease' | null => {
    if (!sermon?.duration_seconds || waveformData.length === 0) return null;
    
    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    const startTime = firstSentence.start_time_ms;
    const endTime = lastSentence.end_time_ms;
    const totalDuration = sermon.duration_seconds * 1000;
    
    // Calculate baseline average volume for entire sermon
    const baselineAverage = waveformData.reduce((sum, amp) => sum + amp, 0) / waveformData.length;
    
    // Map paragraph time range to waveform indices
    const startIdx = Math.floor((startTime / totalDuration) * waveformData.length);
    const endIdx = Math.ceil((endTime / totalDuration) * waveformData.length);
    
    // Calculate average amplitude for this paragraph
    const paragraphAmplitudes = waveformData.slice(startIdx, endIdx);
    const paragraphAverage = paragraphAmplitudes.reduce((sum, amp) => sum + amp, 0) / paragraphAmplitudes.length;
    
    // Calculate ratio relative to baseline
    const volumeRatio = paragraphAverage / baselineAverage;
    
    // Threshold determines sensitivity (e.g., 1.5x baseline)
    const sensitivityMultiplier = 1 + (threshold * 0.3); // Scale threshold to reasonable multiplier
    
    if (volumeRatio > sensitivityMultiplier) return 'increase';
    if (volumeRatio < (1 / sensitivityMultiplier)) return 'decrease';
    return null;
  };

  const calculateSpeechRate = (paragraph: Sentence[]): number => {
    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    const durationSeconds = (lastSentence.end_time_ms - firstSentence.start_time_ms) / 1000;
    const text = paragraph.map(s => s.sentence_text).join(" ");
    const wordCount = text.split(/\s+/).length;
    
    // Words per minute
    return (wordCount / durationSeconds) * 60;
  };

  const getAverageSpeechRate = (): number => {
    if (sentences.length === 0) return 0;
    
    const paragraphs = groupIntoParagraphs(sentences);
    const rates = paragraphs.map(p => calculateSpeechRate(p));
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  };

  const hasFastSpeechRate = (paragraph: Sentence[], threshold: number = 1.5): boolean => {
    if (sentences.length === 0) return false;
    
    const paragraphRate = calculateSpeechRate(paragraph);
    const averageRate = getAverageSpeechRate();
    
    return paragraphRate > averageRate * threshold;
  };

  const countFastSpeechParagraphs = (threshold: number = 1.2): number => {
    if (sentences.length === 0) return 0;
    
    const paragraphs = groupIntoParagraphs(sentences);
    const averageRate = getAverageSpeechRate();
    
    return paragraphs.filter(p => {
      const rate = calculateSpeechRate(p);
      return rate > averageRate * threshold;
    }).length;
  };

  // Speed Dynamics Functions
  const getSpeedVariance = (): { min: number; max: number; stdDev: number; range: number } => {
    if (sentences.length === 0) return { min: 0, max: 0, stdDev: 0, range: 0 };
    
    const paragraphs = groupIntoParagraphs(sentences);
    const rates = paragraphs.map(p => calculateSpeechRate(p));
    
    if (rates.length === 0) return { min: 0, max: 0, stdDev: 0, range: 0 };
    
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const avg = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    const variance = rates.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / rates.length;
    const stdDev = Math.sqrt(variance);
    
    return { min, max, stdDev, range: max - min };
  };

  const countSpeedTransitions = (thresholdWpm: number = 20): number => {
    if (sentences.length === 0) return 0;
    
    const paragraphs = groupIntoParagraphs(sentences);
    const rates = paragraphs.map(p => calculateSpeechRate(p));
    
    let transitions = 0;
    for (let i = 1; i < rates.length; i++) {
      if (Math.abs(rates[i] - rates[i - 1]) >= thresholdWpm) {
        transitions++;
      }
    }
    
    return transitions;
  };

  const getWpmTimelineData = (): { time: number; wpm: number; timeLabel: string }[] => {
    if (sentences.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    
    return paragraphs.map((p, index) => {
      const startMs = p[0].start_time_ms;
      const minutes = Math.floor(startMs / 60000);
      const seconds = Math.floor((startMs % 60000) / 1000);
      
      return {
        time: startMs,
        wpm: Math.round(calculateSpeechRate(p)),
        timeLabel: `${minutes}:${String(seconds).padStart(2, '0')}`
      };
    });
  };

  const getVolumeTimelineData = (): { time: number; volume: number; timeLabel: string }[] => {
    if (sentences.length === 0 || !sermon?.duration_seconds || waveformData.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    const totalDuration = sermon.duration_seconds * 1000;
    const baselineAverage = waveformData.reduce((sum, amp) => sum + amp, 0) / waveformData.length;
    
    return paragraphs.map((p) => {
      const startMs = p[0].start_time_ms;
      const endMs = p[p.length - 1].end_time_ms;
      const minutes = Math.floor(startMs / 60000);
      const seconds = Math.floor((startMs % 60000) / 1000);
      
      // Get waveform data for this paragraph
      const startIdx = Math.floor((startMs / totalDuration) * waveformData.length);
      const endIdx = Math.ceil((endMs / totalDuration) * waveformData.length);
      const paragraphData = waveformData.slice(startIdx, endIdx);
      
      if (paragraphData.length === 0) {
        return { time: startMs, volume: 100, timeLabel: `${minutes}:${String(seconds).padStart(2, '0')}` };
      }
      
      const paragraphAverage = paragraphData.reduce((sum, amp) => sum + amp, 0) / paragraphData.length;
      const volumePercent = Math.round((paragraphAverage / baselineAverage) * 100);
      
      return {
        time: startMs,
        volume: volumePercent,
        timeLabel: `${minutes}:${String(seconds).padStart(2, '0')}`
      };
    });
  };

  const countVerbalPauses = (): number => {
    const fillerWords = {
      single: ['uh', 'um', 'like', 'so', 'well', 'okay', 'right', 'actually', 'basically', 
               'literally', 'honestly', 'seriously', 'anyway', 'just', 'really', 'maybe', 
               'perhaps', 'possibly', 'hmm', 'er', 'ah', 'oh'],
      phrases: ['you know', 'i mean', 'sort of', 'kind of', 'you know what i mean', 
                'the thing is', 'at the end of the day', 'in a sense', 'to be honest', 
                'if you will', 'so yeah', 'well you see', 'i guess', 'i suppose', 
                'its like', 'i was gonna say', 'i think', 'i feel like', 'im not sure but',
                'uh-huh', 'mm-hmm']
    };
    
    let pauseCount = 0;
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      // Check phrases first (they contain multiple words)
      fillerWords.phrases.forEach(filler => {
        const regex = new RegExp(`\\b${filler.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          pauseCount += matches.length;
        }
      });
      
      // Then check single words
      fillerWords.single.forEach(filler => {
        const regex = new RegExp(`\\b${filler}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          pauseCount += matches.length;
        }
      });
    });
    
    return pauseCount;
  };

  const handleSaveTitle = async () => {
    if (!sermon) return;
    try {
      const { error } = await supabase
        .from("sermons")
        .update({ title: titleInput.trim() || null })
        .eq("id", sermon.id);

      if (error) throw error;

      setSermon({ ...sermon, title: titleInput.trim() || null });
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
      setEditingTitle(false);
    }
  };

  const getTopFillerWords = (): { word: string; count: number; color: string }[] => {
    const fillerWords = {
      single: ['uh', 'um', 'like', 'so', 'well', 'okay', 'right', 'actually', 'basically', 
               'literally', 'honestly', 'seriously', 'anyway', 'just', 'really', 'maybe', 
               'perhaps', 'possibly', 'hmm', 'er', 'ah', 'oh'],
      phrases: ['you know', 'i mean', 'sort of', 'kind of', 'you know what i mean', 
                'the thing is', 'at the end of the day', 'in a sense', 'to be honest', 
                'if you will', 'so yeah', 'well you see', 'i guess', 'i suppose', 
                'its like', 'i was gonna say', 'i think', 'i feel like', 'im not sure but',
                'uh-huh', 'mm-hmm']
    };
    
    const colors = ['#f97316', '#fb923c', '#fdba74']; // orange variations
    const wordCounts: { [key: string]: number } = {};
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      // Check phrases first
      fillerWords.phrases.forEach(filler => {
        const regex = new RegExp(`\\b${filler.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          wordCounts[filler] = (wordCounts[filler] || 0) + matches.length;
        }
      });
      
      // Then check single words
      fillerWords.single.forEach(filler => {
        const regex = new RegExp(`\\b${filler}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          wordCounts[filler] = (wordCounts[filler] || 0) + matches.length;
        }
      });
    });
    
    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((entry, idx) => ({
        word: entry[0],
        count: entry[1],
        color: colors[idx]
      }));
  };

  const getAllFillerWords = (): { word: string; count: number }[] => {
    const fillerWords = {
      single: ['uh', 'um', 'like', 'so', 'well', 'okay', 'right', 'actually', 'basically', 
               'literally', 'honestly', 'seriously', 'anyway', 'just', 'really', 'maybe', 
               'perhaps', 'possibly', 'hmm', 'er', 'ah', 'oh'],
      phrases: ['you know', 'i mean', 'sort of', 'kind of', 'you know what i mean', 
                'the thing is', 'at the end of the day', 'in a sense', 'to be honest', 
                'if you will', 'so yeah', 'well you see', 'i guess', 'i suppose', 
                'its like', 'i was gonna say', 'i think', 'i feel like', 'im not sure but',
                'uh-huh', 'mm-hmm']
    };
    
    const wordCounts: { [key: string]: number } = {};
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      fillerWords.phrases.forEach(filler => {
        const regex = new RegExp(`\\b${filler.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          wordCounts[filler] = (wordCounts[filler] || 0) + matches.length;
        }
      });
      
      fillerWords.single.forEach(filler => {
        const regex = new RegExp(`\\b${filler}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          wordCounts[filler] = (wordCounts[filler] || 0) + matches.length;
        }
      });
    });
    
    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));
  };

  const getFillerWordTimestamps = (fillerWord: string): { start: number; end: number }[] => {
    const timestamps: { start: number; end: number }[] = [];
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      const regex = new RegExp(`\\b${fillerWord}\\b`, 'gi');
      if (regex.test(text)) {
        timestamps.push({
          start: sentence.start_time_ms,
          end: sentence.end_time_ms
        });
      }
    });
    
    return timestamps;
  };

  const toggleFillerWord = (word: string) => {
    const newSet = new Set(visibleFillerWords);
    if (newSet.has(word)) {
      newSet.delete(word);
    } else {
      newSet.add(word);
    }
    setVisibleFillerWords(newSet);
  };

  const countSilentPauses = (minGapMs: number = 3000): number => {
    if (sentences.length < 2) return 0;
    let count = 0;
    for (let i = 1; i < sentences.length; i++) {
      const gap = sentences[i].start_time_ms - sentences[i - 1].end_time_ms;
      if (gap >= minGapMs) count++;
    }
    return count;
  };

  const getSilentPauseTimestamps = (minGapMs: number = 3000): { start: number; end: number; durationMs: number }[] => {
    const pauses: { start: number; end: number; durationMs: number }[] = [];
    for (let i = 1; i < sentences.length; i++) {
      const gap = sentences[i].start_time_ms - sentences[i - 1].end_time_ms;
      if (gap >= minGapMs) {
        pauses.push({ start: sentences[i - 1].end_time_ms, end: sentences[i].start_time_ms, durationMs: gap });
      }
    }
    return pauses;
  };

  const countInsiderLanguage = (): number => {
    const insiderTerms = {
      single: ['sanctification', 'justification', 'redemption', 'atonement', 'repentance', 
               'trinity', 'gospel', 'salvation', 'saved', 'resurrection', 'discipleship',
               'covenant', 'righteousness', 'idolatry', 'pharisee', 'sadducee', 'propitiation',
               'disciple', 'apostle', 'shepherding', 'iniquity', 'transgression', 'missional',
               'elders', 'deacons', 'liturgy', 'narthex', 'vestibule', 'sanctuary', 'anointed',
               'revival', 'holiness', 'calvinist', 'arminian', 'eucharist', 'apologetics',
                'legalism', 'benediction', 'baptism'],
      phrases: ['quiet time', 'devotional time', 'prayer warrior', 'love offering', 'fellowship',
                'covered by the blood', 'hedge of protection', 'being led', 'i feel led',
                'doing life together', 'on fire for god', 'being called', 'baby christian',
                'mature christian', 'servant leadership', 'missional living', 'the church',
                'accountability partner', 'small group', 'community group', 'life group',
                'spiritual disciplines', 'worship time', 'church home', 'church family',
                'church plant', 'doing ministry', 'sin nature', 'spiritual gifts',
                'spiritual warfare', 'holy spirit', 'the spirit', 'born again', 'new birth',
                'altar call', "the lord's supper", 'passing the plate', 'worship leader',
                'sermon series', 'asking jesus into your heart', 'personal relationship with jesus',
                'lost people', 'the lost', 'reaching the unreached', 'the great commission',
                'spiritual attack', 'prayer covering', 'kingdom work', 'called to ministry',
                'faith step', 'prosperity gospel', 'fruit of the spirit', 'armor of god',
                'kingdom of heaven', 'kingdom of god', 'lamb of god', 'ministry team',
                'global partners', 'pastoral care', 'shepherding team', 'church polity',
                'praise and worship', 'praise & worship', 'worship experience', 'spirit moving',
                'worship night', 'vacation bible school', 'vbs', 'testimony', 'purity culture',
                'accountability group', 'contemporary christian music', 'ccm', 'we as christians']
    };
    
    let termCount = 0;
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      // Check phrases first
      insiderTerms.phrases.forEach(term => {
        const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+').replace(/'/g, "\\'")}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCount += matches.length;
        }
      });
      
      // Then check single words
      insiderTerms.single.forEach(term => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCount += matches.length;
        }
      });
    });
    
    return termCount;
  };

  const getTopInsiderTerms = (): { word: string; count: number; color: string }[] => {
    const insiderTerms = {
      single: ['sanctification', 'justification', 'redemption', 'atonement', 'repentance', 
               'trinity', 'gospel', 'salvation', 'saved', 'resurrection', 'discipleship',
               'covenant', 'righteousness', 'idolatry', 'pharisee', 'sadducee', 'propitiation',
               'disciple', 'apostle', 'shepherding', 'iniquity', 'transgression', 'missional',
               'elders', 'deacons', 'liturgy', 'narthex', 'vestibule', 'sanctuary', 'anointed',
               'revival', 'holiness', 'calvinist', 'arminian', 'eucharist', 'apologetics',
                'legalism', 'benediction', 'baptism'],
      phrases: ['quiet time', 'devotional time', 'prayer warrior', 'love offering', 'fellowship',
                'covered by the blood', 'hedge of protection', 'being led', 'i feel led',
                'doing life together', 'on fire for god', 'being called', 'baby christian',
                'mature christian', 'servant leadership', 'missional living', 'the church',
                'accountability partner', 'small group', 'community group', 'life group',
                'spiritual disciplines', 'worship time', 'church home', 'church family',
                'church plant', 'doing ministry', 'sin nature', 'spiritual gifts',
                'spiritual warfare', 'holy spirit', 'the spirit', 'born again', 'new birth',
                'altar call', "the lord's supper", 'passing the plate', 'worship leader',
                'sermon series', 'asking jesus into your heart', 'personal relationship with jesus',
                'lost people', 'the lost', 'reaching the unreached', 'the great commission',
                'spiritual attack', 'prayer covering', 'kingdom work', 'called to ministry',
                'faith step', 'prosperity gospel', 'fruit of the spirit', 'armor of god',
                'kingdom of heaven', 'kingdom of god', 'lamb of god', 'ministry team',
                'global partners', 'pastoral care', 'shepherding team', 'church polity',
                'praise and worship', 'praise & worship', 'worship experience', 'spirit moving',
                'worship night', 'vacation bible school', 'vbs', 'testimony', 'purity culture',
                'accountability group', 'contemporary christian music', 'ccm', 'we as christians']
    };
    
    const colors = ['#6366f1', '#818cf8', '#a5b4fc']; // indigo variations
    const termCounts: { [key: string]: number } = {};
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      // Check phrases first
      insiderTerms.phrases.forEach(term => {
        const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+').replace(/'/g, "\\'")}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCounts[term] = (termCounts[term] || 0) + matches.length;
        }
      });
      
      // Then check single words
      insiderTerms.single.forEach(term => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCounts[term] = (termCounts[term] || 0) + matches.length;
        }
      });
    });
    
    return Object.entries(termCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((entry, idx) => ({
        word: entry[0],
        count: entry[1],
        color: colors[idx]
      }));
  };

  const getAllInsiderTerms = (): { word: string; count: number }[] => {
    const insiderTerms = {
      single: ['sanctification', 'justification', 'redemption', 'atonement', 'repentance', 
               'trinity', 'gospel', 'salvation', 'saved', 'resurrection', 'discipleship',
               'covenant', 'righteousness', 'idolatry', 'pharisee', 'sadducee', 'propitiation',
               'disciple', 'apostle', 'shepherding', 'iniquity', 'transgression', 'missional',
               'elders', 'deacons', 'liturgy', 'narthex', 'vestibule', 'sanctuary', 'anointed',
               'revival', 'holiness', 'calvinist', 'arminian', 'eucharist', 'apologetics',
               'legalism', 'benediction', 'baptism'],
      phrases: ['quiet time', 'devotional time', 'prayer warrior', 'love offering', 'fellowship',
                'covered by the blood', 'hedge of protection', 'being led', 'i feel led',
                'doing life together', 'on fire for god', 'being called', 'baby christian',
                'mature christian', 'servant leadership', 'missional living', 'the church',
                'accountability partner', 'small group', 'community group', 'life group',
                'spiritual disciplines', 'worship time', 'church home', 'church family',
                'church plant', 'doing ministry', 'sin nature', 'spiritual gifts',
                'spiritual warfare', 'holy spirit', 'the spirit', 'born again', 'new birth',
                'altar call', "the lord's supper", 'passing the plate', 'worship leader',
                'sermon series', 'asking jesus into your heart', 'personal relationship with jesus',
                'lost people', 'the lost', 'reaching the unreached', 'the great commission',
                'spiritual attack', 'prayer covering', 'kingdom work', 'called to ministry',
                'faith step', 'prosperity gospel', 'fruit of the spirit', 'armor of god',
                'kingdom of heaven', 'kingdom of god', 'lamb of god', 'ministry team',
                'global partners', 'pastoral care', 'shepherding team', 'church polity',
                'praise and worship', 'praise & worship', 'worship experience', 'spirit moving',
                'worship night', 'vacation bible school', 'vbs', 'testimony', 'purity culture',
                'accountability group', 'contemporary christian music', 'ccm', 'we as christians']
    };
    
    const termCounts: { [key: string]: number } = {};
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      
      insiderTerms.phrases.forEach(term => {
        const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+').replace(/'/g, "\\'")}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCounts[term] = (termCounts[term] || 0) + matches.length;
        }
      });
      
      insiderTerms.single.forEach(term => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          termCounts[term] = (termCounts[term] || 0) + matches.length;
        }
      });
    });
    
    return Object.entries(termCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));
  };

  const getInsiderTermTimestamps = (term: string): { start: number; end: number }[] => {
    const timestamps: { start: number; end: number }[] = [];
    
    sentences.forEach(sentence => {
      const text = sentence.sentence_text.toLowerCase();
      const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+').replace(/'/g, "\\'")}\\b`, 'gi');
      if (regex.test(text)) {
        timestamps.push({
          start: sentence.start_time_ms,
          end: sentence.end_time_ms
        });
      }
    });
    
    return timestamps;
  };

  const toggleInsiderTerm = (term: string) => {
    const newSet = new Set(visibleInsiderTerms);
    if (newSet.has(term)) {
      newSet.delete(term);
    } else {
      newSet.add(term);
    }
    setVisibleInsiderTerms(newSet);
  };

  const getRepeatedPhrases = (minCount: number = 3): { word: string; count: number }[] => {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'is', 'it', 'its', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'shall', 'can', 'need', 'i', 'me', 'my',
      'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
      'their', 'what', 'which', 'who', 'this', 'that', 'these', 'those', 'am',
      'not', 'no', 'as', 'if', 'then', 'than', 'so', 'just',
      't', 's', 'd', 'm', 'll', 've', 're',
    ]);

    // Collect all words from the transcript
    const allWords: string[] = [];
    sentences.forEach(sentence => {
      const words = sentence.sentence_text.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(w => w.length > 0);
      words.forEach(w => {
        const cleaned = w.replace(/^'+|'+$/g, '');
        if (cleaned.length > 1) allWords.push(cleaned);
      });
    });

    const phraseCounts: Record<string, number> = {};

    // Extract n-grams of size 2, 3, and 4
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i <= allWords.length - n; i++) {
        const phrase = allWords.slice(i, i + n);
        // Skip phrases that are entirely stop words
        const meaningfulWords = phrase.filter(w => !stopWords.has(w));
        if (meaningfulWords.length < 1) continue;
        // Skip if phrase starts AND ends with a stop word for 2-grams
        if (n === 2 && stopWords.has(phrase[0]) && stopWords.has(phrase[1])) continue;
        const key = phrase.join(' ');
        phraseCounts[key] = (phraseCounts[key] || 0) + 1;
      }
    }

    // Remove phrases that are substrings of higher-count longer phrases
    const entries = Object.entries(phraseCounts)
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1]);

    const filtered: [string, number][] = [];
    for (const [phrase, count] of entries) {
      // Check if this phrase is a subset of an already-accepted longer phrase with equal or higher count
      const isRedundant = filtered.some(([longer, longerCount]) => 
        longer.length > phrase.length && longer.includes(phrase) && longerCount >= count
      );
      if (!isRedundant) {
        filtered.push([phrase, count]);
      }
    }

    return filtered.map(([word, count]) => ({ word, count }));
  };

  // ===== ENGAGEMENT SCORING FUNCTIONS =====
  
  // Helper: maps a value from [low, high] to [1, 10] with clamping
  const scaleScore = (value: number, low: number, mid: number, high: number): number => {
    // low = score 1, mid = score 5, high = score 10
    let score: number;
    if (value <= low) return 1;
    if (value >= high) return 10;
    if (value <= mid) {
      score = 1 + ((value - low) / (mid - low)) * 4; // 1-5
    } else {
      score = 5 + ((value - mid) / (high - mid)) * 5; // 5-10
    }
    return Math.round(Math.min(10, Math.max(1, score)));
  };

  const getPaceDynamicsScore = (): number => {
    if (sentences.length === 0) return 5;
    const { stdDev } = getSpeedVariance();
    const avgWpm = getAverageSpeechRate();
    if (avgWpm === 0) return 5;
    const cv = stdDev / avgWpm;
    const cvScore = scaleScore(cv, 0.08, 0.15, 0.30);

    const paragraphs = groupIntoParagraphs(sentences);
    if (paragraphs.length <= 1) return cvScore;
    const transitions20 = countSpeedTransitions(20);
    const ratio = transitions20 / paragraphs.length;
    const transitionScore = scaleScore(ratio, 0.10, 0.40, 0.75);

    // Blend: 50% spread + 50% transitions
    return Math.round((cvScore + transitionScore) / 2);
  };

  const getVolumeDynamicsScore = (): number => {
    if (sentences.length === 0 || waveformData.length === 0) return 5;
    
    const paragraphs = groupIntoParagraphs(sentences);
    if (paragraphs.length < 2) return 5;
    
    const baselineAverage = waveformData.reduce((sum, val) => sum + val, 0) / waveformData.length;
    if (baselineAverage === 0) return 1;
    
    const paragraphVolumes = paragraphs.map(paragraph => {
      const first = paragraph[0];
      const last = paragraph[paragraph.length - 1];
      if (!first || !last || !sermon?.duration_seconds) return baselineAverage;
      const startIdx = Math.floor((first.start_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
      const endIdx = Math.ceil((last.end_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
      const slice = waveformData.slice(Math.max(0, startIdx), Math.min(waveformData.length, endIdx));
      return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : baselineAverage;
    });
    
    const mean = paragraphVolumes.reduce((a, b) => a + b, 0) / paragraphVolumes.length;
    if (mean === 0) return 1;
    const variance = paragraphVolumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / paragraphVolumes.length;
    const cv = Math.sqrt(variance) / mean;
    // Spread: 0.03=1, 0.12=5, 0.35=10
    return scaleScore(cv, 0.03, 0.12, 0.35);
  };

  const getUseOfSilenceScore = (): number => {
    if (sentences.length < 2) return 5;
    const pauseCount = countSilentPauses(3000);
    // 0 pauses = 1 (no silence), 15 = 5 (moderate), 40 = 10 (excellent)
    return scaleScore(pauseCount, 0, 15, 40);
  };

  const getSentenceVarietyScore = (): number => {
    if (sentences.length < 3) return 5;
    const lengths = sentences.map(s => s.sentence_text.split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const stdDev = Math.sqrt(lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length);
    const cv = stdDev / avg;
    return scaleScore(cv, 0.45, 0.75, 1.1);
  };

  const getIllustrationScore = (): number => {
    if (!illustrationData) return 0;
    return illustrationData.illustration_score;
  };

  const getEngagementScore = (): { total: number; subscores: { label: string; score: number; icon: string }[] } => {
    const paceDynamics = getPaceDynamicsScore();
    const volumeDynamics = getVolumeDynamicsScore();
    const useOfSilence = getUseOfSilenceScore();
    const illustrationScore = getIllustrationScore();

    const subscores = [
      { label: "Pace Dynamics", score: paceDynamics, icon: "🎯" },
      { label: "Volume Dynamics", score: volumeDynamics, icon: "🔊" },
      { label: "Use of Silence", score: useOfSilence, icon: "🤫" },
      { label: "Illustrations & Stories", score: illustrationScore, icon: "🎭" },
    ];

    // Only include illustration score if loaded
    const scoresToAvg = illustrationScore > 0 
      ? subscores 
      : subscores.filter(s => s.label !== "Illustrations & Stories");
    
    const total = scoresToAvg.length > 0 
      ? Math.round(scoresToAvg.reduce((sum, s) => sum + s.score, 0) / scoresToAvg.length)
      : 5;

    return { total, subscores };
  };

  const fetchIllustrations = async () => {
    if (!id || loadingIllustrations) return;
    setLoadingIllustrations(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-illustrations', {
        body: { sermonId: id }
      });
      if (error) throw error;
      setIllustrationData(data);
    } catch (error: any) {
      console.error("Failed to analyze illustrations:", error);
      toast({
        title: "Analysis failed",
        description: error.message || "Could not analyze illustrations",
        variant: "destructive",
      });
    } finally {
      setLoadingIllustrations(false);
    }
  };

  const countSlowSpeechParagraphs = (threshold: number = 0.75): number => {
    if (sentences.length === 0) return 0;
    
    const paragraphs = groupIntoParagraphs(sentences);
    const averageRate = getAverageSpeechRate();
    
    return paragraphs.filter(p => {
      const rate = calculateSpeechRate(p);
      return rate < averageRate * threshold;
    }).length;
  };

  const getSlowSpeechParagraphs = (threshold: number = 0.75) => {
    if (sentences.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    const averageRate = getAverageSpeechRate();
    
    return paragraphs.filter(p => {
      const rate = calculateSpeechRate(p);
      return rate < averageRate * threshold;
    });
  };

  const countVolumeChangeParagraphs = (): { [key: number]: number } => {
    if (sentences.length === 0 || !sermon?.duration_seconds || waveformData.length === 0) {
      return { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
    }
    
    const paragraphs = groupIntoParagraphs(sentences);
    const counts: { [key: number]: number } = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
    
    // Calculate baseline average volume for entire sermon
    const baselineAverage = waveformData.reduce((sum, val) => sum + val, 0) / waveformData.length;
    
    paragraphs.forEach(paragraph => {
      const firstSentence = paragraph[0];
      const lastSentence = paragraph[paragraph.length - 1];
      if (!firstSentence || !lastSentence) return;
      
      const startIndex = Math.floor((firstSentence.start_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
      const endIndex = Math.ceil((lastSentence.end_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
      
      if (startIndex >= waveformData.length || endIndex > waveformData.length) return;
      
      const paragraphData = waveformData.slice(startIndex, endIndex);
      if (paragraphData.length === 0) return;
      
      const paragraphAverage = paragraphData.reduce((sum, val) => sum + val, 0) / paragraphData.length;
      
      // Calculate the ratio of paragraph volume to baseline volume
      const volumeRatio = paragraphAverage / baselineAverage;
      
      // Categorize based on how much louder/quieter relative to baseline
      // +2: 30%+ louder
      // +1: 15-30% louder  
      // 0: within 15% of baseline
      // -1: 15-30% quieter
      // -2: 30%+ quieter
      if (volumeRatio >= 1.3) {
        counts[2]++;
      } else if (volumeRatio >= 1.15) {
        counts[1]++;
      } else if (volumeRatio <= 0.7) {
        counts[-2]++;
      } else if (volumeRatio <= 0.85) {
        counts[-1]++;
      } else {
        counts[0]++;
      }
    });
    
    return counts;
  };

  const getParagraphVolumeLevel = (paragraph: Sentence[]): number => {
    if (!sermon?.duration_seconds || waveformData.length === 0) return 0;
    
    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    
    const startIndex = Math.floor((firstSentence.start_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
    const endIndex = Math.ceil((lastSentence.end_time_ms / 1000 / sermon.duration_seconds) * waveformData.length);
    
    if (startIndex >= waveformData.length || endIndex > waveformData.length) return 0;
    
    const paragraphData = waveformData.slice(startIndex, endIndex);
    if (paragraphData.length === 0) return 0;
    
    const baselineAverage = waveformData.reduce((sum, val) => sum + val, 0) / waveformData.length;
    const paragraphAverage = paragraphData.reduce((sum, val) => sum + val, 0) / paragraphData.length;
    
    const volumeRatio = paragraphAverage / baselineAverage;
    
    if (volumeRatio >= 1.3) return 2;
    if (volumeRatio >= 1.15) return 1;
    if (volumeRatio <= 0.7) return -2;
    if (volumeRatio <= 0.85) return -1;
    return 0;
  };

  const getVolumeChangeParagraphs = () => {
    if (sentences.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    
    // Only return paragraphs with non-baseline volume (not level 0)
    return paragraphs.filter(p => getParagraphVolumeLevel(p) !== 0);
  };

  // Build an expanded Set of scripture sentence indices that fills gaps.
  // If sentences 17,18,20,21 are scripture, sentence 19 (between them) is too.
  const scriptureSentenceIndices = useMemo(() => {
    if (!scriptureRefs?.scripture_sentence_indices || scriptureRefs.scripture_sentence_indices.length === 0) {
      return new Set<number>();
    }
    const raw = [...scriptureRefs.scripture_sentence_indices].sort((a, b) => a - b);
    const expanded = new Set(raw);
    
    // Fill gaps of up to 3 sentences between scripture indices
    for (let i = 0; i < raw.length - 1; i++) {
      const gap = raw[i + 1] - raw[i];
      if (gap <= 4) {
        for (let j = raw[i] + 1; j < raw[i + 1]; j++) {
          expanded.add(j);
        }
      }
    }
    return expanded;
  }, [scriptureRefs]);

  // Build a set of normalized scripture sentence texts for cross-reference matching
  // This catches re-quotes of the same verse later in the sermon
  const scriptureTextFingerprints = useMemo(() => {
    if (scriptureSentenceIndices.size === 0 || sentences.length === 0) return new Set<string>();
    const fingerprints = new Set<string>();
    sentences.forEach((s, idx) => {
      if (scriptureSentenceIndices.has(idx)) {
        // Create a normalized fingerprint: lowercase, no punctuation, trimmed
        const fp = s.sentence_text.toLowerCase().replace(/[?.,!;:'"]/g, '').trim();
        if (fp.length > 20) { // Only meaningful sentences
          fingerprints.add(fp);
        }
      }
    });
    return fingerprints;
  }, [scriptureSentenceIndices, sentences]);

  // Check if a sentence is part of a scripture quotation
  const isSentenceInScripture = (sentenceText: string, sentenceIndex?: number): boolean => {
    if (!scriptureRefs) return false;
    
    // 1. Index-based matching with gap-filling
    if (sentenceIndex !== undefined && scriptureSentenceIndices.size > 0) {
      if (scriptureSentenceIndices.has(sentenceIndex)) return true;
    }
    
    // 2. Cross-reference: check if this sentence's text closely matches any known scripture sentence
    // This catches re-quotes of the same verse appearing elsewhere in the sermon
    if (scriptureTextFingerprints.size > 0) {
      const fp = sentenceText.toLowerCase().replace(/[?.,!;:'"]/g, '').trim();
      if (fp.length > 20) {
        // Exact fingerprint match
        if (scriptureTextFingerprints.has(fp)) return true;
        // Check if this sentence is substantially contained in or contains a scripture fingerprint
        for (const sfp of scriptureTextFingerprints) {
          if (fp.includes(sfp) || sfp.includes(fp)) return true;
          // Check significant word overlap (>70% of words match)
          const fpWords = fp.split(/\s+/);
          const sfpWords = sfp.split(/\s+/);
          if (fpWords.length >= 5 && sfpWords.length >= 5) {
            const sfpSet = new Set(sfpWords);
            const overlap = fpWords.filter(w => sfpSet.has(w)).length;
            if (overlap / Math.min(fpWords.length, sfpWords.length) > 0.7) return true;
          }
        }
      }
    }
    
    // 3. Direct reference name match
    const text = sentenceText.toLowerCase().trim();
    if (scriptureRefs.references.some(ref => text.includes(ref.reference.toLowerCase()))) return true;
    
    return false;
  };

  const paragraphContainsScripture = (paragraph: Sentence[]): boolean => {
    if (!scriptureRefs || !showScriptureRefs) return false;
    
    const paragraphText = paragraph.map(s => s.sentence_text).join(" ");
    
    // Check if any scripture reference context appears in this paragraph
    return scriptureRefs.references.some(ref => {
      const contextWords = ref.context.split(' ').slice(0, 10).join(' ');
      return paragraphText.includes(contextWords) || paragraphText.includes(ref.reference);
    });
  };

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
        .maybeSingle();

      if (error) throw error;
      
      if (!data) {
        toast({
          title: "Sermon not found",
          description: "This sermon doesn't exist or you don't have access to it.",
          variant: "destructive",
        });
        navigate("/dashboard");
        return;
      }
      
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
        .select(`
          *,
          evaluation_rules (
            id,
            name,
            description,
            color
          )
        `)
        .eq("sermon_id", id)
        .order("start_time_ms");

      if (error) throw error;
      setComments(data || []);
    } catch (error: any) {
      console.error("Failed to load comments:", error);
    }
  };

  const fetchRules = async () => {
    try {
      const { data, error } = await supabase
        .from("evaluation_rules")
        .select("id, name, description, color")
        .order("name");

      if (error) throw error;
      setRules(data || []);
    } catch (error: any) {
      console.error("Failed to load rules:", error);
    }
  };

  const handleEvaluate = async () => {
    if (selectedRuleIds.length === 0) {
      toast({
        title: "No rules selected",
        description: "Please select at least one rule",
        variant: "destructive",
      });
      return;
    }

    setEvaluating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("evaluate-sermon", {
        body: {
          sermonId: id,
          ruleIds: selectedRuleIds,
        },
      });

      if (error) throw error;

      toast({
        title: "Evaluation complete",
        description: `Created ${data.commentsCreated} new comments`,
      });

      setEvaluationDialogOpen(false);
      setSelectedRuleIds([]);
      fetchComments();
    } catch (error: any) {
      toast({
        title: "Evaluation failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setEvaluating(false);
    }
  };

  const handleSummarizeComments = async () => {
    if (comments.length === 0) {
      toast({
        title: "No comments to summarize",
        description: "Add some comments first before generating a summary",
        variant: "destructive",
      });
      return;
    }

    setSummarizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-comments", {
        body: { sermonId: id },
      });

      if (error) throw error;

      setCommentSummary(data);
      setSummaryOpen(true);

      toast({
        title: "Summary generated",
        description: "AI analysis of all sermon comments complete",
      });
    } catch (error: any) {
      toast({
        title: "Summary failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSummarizing(false);
    }
  };

  const fetchScriptureReferences = async () => {
    setLoadingScriptures(true);
    try {
      const { data, error } = await supabase.functions.invoke("count-scripture-refs", {
        body: { sermonId: id },
      });

      if (error) throw error;

      setScriptureRefs(data);
    } catch (error: any) {
      console.error("Failed to load scripture references:", error);
      toast({
        title: "Failed to load scripture references",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingScriptures(false);
    }
  };

  const fetchCongregationQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const { data, error } = await supabase.functions.invoke("classify-questions", {
        body: { sermonId: id },
      });
      if (error) throw error;
      if (data?.congregation_indices) {
        setCongregationQuestionIndices(new Set(data.congregation_indices));
      }
    } catch (error: any) {
      console.error("Failed to classify questions:", error);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const fetchConfusingPhrases = async () => {
    setLoadingConfusing(true);
    try {
      const { data, error } = await supabase.functions.invoke("flag-confusing-phrases", {
        body: { sermonId: id },
      });

      if (error) throw error;

      setConfusingPhrases(data);
    } catch (error: any) {
      console.error("Failed to load confusing phrases:", error);
      toast({
        title: "Failed to analyze visitor confusion",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingConfusing(false);
    }
  };

  const groupIntoParagraphs = (sentences: Sentence[]) => {
    const paragraphs = [];
    for (let i = 0; i < sentences.length; i += 5) {
      paragraphs.push(sentences.slice(i, i + 5));
    }
    return paragraphs;
  };

  const isCurrentSentence = (sentence: Sentence) => {
    return currentTime >= sentence.start_time_ms && currentTime < sentence.end_time_ms;
  };

  const isCurrentParagraph = (paragraph: Sentence[]) => {
    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    return currentTime >= firstSentence.start_time_ms && currentTime < lastSentence.end_time_ms;
  };

  const seekTo = (timeMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = timeMs / 1000;
      setCurrentTime(timeMs);
    }
  };

  const togglePlayPause = () => {
    const commentAudio = commentAudioRef.current;
    
    // If comment is playing, control comment audio
    if (commentAudio && playingCommentId) {
      if (commentAudio.paused) {
        commentAudio.play().catch(() => {});
      } else {
        commentAudio.pause();
      }
      return;
    }
    
    // Otherwise control sermon audio
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(() => {});
      }
      setPlaying(!playing);
    }
  };

  const handleTimeUpdate = async () => {
    if (audioRef.current) {
      const currentMs = audioRef.current.currentTime * 1000;
      const previousMs = lastTimeRef.current;
      lastTimeRef.current = currentMs;
      setCurrentTime(currentMs);
      
      // Check if we should play an audio comment
      // Use DOM element's paused state directly to avoid stale React state closure issues
      if (previewWithComments && !audioRef.current.paused && !playingCommentId) {
        const audioComments = comments.filter(c => c.audio_url);
        
        // Find comments whose start time we've crossed over since last update
        // Also handle the case where we're within 500ms of the start time (for slower update intervals)
        for (const comment of audioComments) {
          // Skip if we've already played this comment
          if (playedCommentIds.has(comment.id)) continue;
          
          // Check if we've crossed over the comment start time, or are within range
          const crossedOver = previousMs < comment.start_time_ms && currentMs >= comment.start_time_ms;
          const withinRange = currentMs >= comment.start_time_ms && currentMs < comment.start_time_ms + 500;
          
          if (crossedOver || withinRange) {
            // Mark this comment as played
            setPlayedCommentIds(prev => new Set([...prev, comment.id]));
            
            // Pause sermon and play comment
            audioRef.current.pause();
            setPlayingCommentId(comment.id);
            
            // Get signed URL if we don't have it
            let url = commentSignedUrls[comment.id];
            if (!url) {
              const { data } = await supabase.storage
                .from("sermon-comments-audio")
                .createSignedUrl(comment.audio_url!, 3600);
              if (data?.signedUrl) {
                url = data.signedUrl;
                setCommentSignedUrls(prev => ({ ...prev, [comment.id]: url }));
              }
            }
            
            if (url) {
              // Stop any existing comment audio before playing new one
              if (commentAudioRef.current) {
                try {
                  commentAudioRef.current.pause();
                  commentAudioRef.current.src = '';
                } catch (e) {
                  // Ignore errors when stopping
                }
                commentAudioRef.current = null;
              }
              
              const audio = new Audio(url);
              audio.volume = commentVolume;
              commentAudioRef.current = audio;
              
              // Use a flag to prevent double-handling
              let handled = false;
              
              const cleanup = () => {
                if (handled) return;
                handled = true;
                setPlayingCommentId(null);
                commentAudioRef.current = null;
                // Resume sermon playback
                if (audioRef.current) {
                  audioRef.current.play().catch(() => {});
                }
              };
              
              audio.onended = cleanup;
              
              // Only handle actual network/decode errors, not abort errors
              audio.onerror = (e) => {
                const mediaError = audio.error;
                if (mediaError && mediaError.code !== MediaError.MEDIA_ERR_ABORTED) {
                  console.error('Error playing comment audio:', mediaError.message);
                  cleanup();
                }
              };
              
              try {
                await audio.play();
              } catch (err: any) {
                // Only log and cleanup for non-abort errors
                if (err.name !== 'AbortError') {
                  console.error('Failed to play comment:', err);
                  cleanup();
                }
              }
            } else {
              // If we couldn't get the URL, continue playback
              setPlayingCommentId(null);
              if (audioRef.current) {
                audioRef.current.play();
              }
            }
            break;
          }
        }
      }
    }
  };
  
  // Helper to stop any currently playing comment audio
  const stopCommentAudio = () => {
    if (commentAudioRef.current) {
      commentAudioRef.current.pause();
      commentAudioRef.current.src = '';
      commentAudioRef.current = null;
    }
    setPlayingCommentId(null);
  };

  // Reset played comments when seeking backwards or toggling preview mode
  const handleSeeked = () => {
    // Stop any playing comment when user seeks
    stopCommentAudio();
    
    if (audioRef.current) {
      const currentMs = audioRef.current.currentTime * 1000;
      // Reset played comments that are after the current position
      setPlayedCommentIds(prev => {
        const newSet = new Set<string>();
        prev.forEach(id => {
          const comment = comments.find(c => c.id === id);
          if (comment && comment.start_time_ms < currentMs) {
            newSet.add(id);
          }
        });
        return newSet;
      });
      lastTimeRef.current = currentMs;
    }
  };

  // Handle main audio pause - stop comment audio too
  const handleAudioPause = () => {
    setPlaying(false);
    stopCommentAudio();
  };

  const openCommentDialog = (start: number, end: number) => {
    setSelectedTimeRange({ start, end });
    setCommentDialogOpen(true);
  };

  const handleAutoSaveAudioComment = async (blob: Blob) => {
    if (!selectedTimeRange) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      setTranscribing(true);
      
      // Transcribe the audio first
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');
      
      let commentText = "Audio comment";
      
      const transcribeResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio-comment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: formData,
        }
      );

      if (transcribeResponse.ok) {
        const { text } = await transcribeResponse.json();
        commentText = text || "Audio comment (transcription failed)";
      }
      
      // Upload the audio file
      const audioPath = `${user.id}/${crypto.randomUUID()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from("sermon-comments-audio")
        .upload(audioPath, blob);

      if (uploadError) throw uploadError;

      const { error } = await supabase
        .from("sermon_comments")
        .insert([{
          sermon_id: id,
          user_id: user.id,
          start_time_ms: selectedTimeRange.start,
          end_time_ms: selectedTimeRange.end,
          comment_text: commentText,
          audio_url: audioPath,
        }]);

      if (error) throw error;

      toast({ title: "Audio comment saved" });
      setCommentDialogOpen(false);
      setAudioBlob(null);
      
      // Seek to the next sentence so spacebar resumes past the comment
      const nextSentence = sentences.find(s => s.start_time_ms > selectedTimeRange.start);
      if (nextSentence && audioRef.current) {
        audioRef.current.currentTime = nextSentence.start_time_ms / 1000;
        lastTimeRef.current = nextSentence.start_time_ms;
      }
      
      fetchComments();
    } catch (error: any) {
      toast({
        title: "Error saving audio comment",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTranscribing(false);
    }
  };

  const handleAddComment = async () => {
    if ((!newComment.trim() && !audioBlob) || !selectedTimeRange) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let audioUrl = null;
      let commentText = newComment;

      // Upload and transcribe audio if present
      if (audioBlob) {
        setTranscribing(true);
        
        // Transcribe the audio first
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');
        
        const transcribeResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio-comment`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
            body: formData,
          }
        );

        if (transcribeResponse.ok) {
          const { text } = await transcribeResponse.json();
          commentText = text || "Audio comment (transcription failed)";
        } else {
          console.error('Transcription failed, using fallback');
          commentText = "Audio comment";
        }
        
        setTranscribing(false);

        // Upload the audio file
        const audioPath = `${user.id}/${crypto.randomUUID()}.webm`;
        const { error: uploadError } = await supabase.storage
          .from("sermon-comments-audio")
          .upload(audioPath, audioBlob);

        if (uploadError) throw uploadError;
        audioUrl = audioPath;
      }

      const { error } = await supabase
        .from("sermon_comments")
        .insert([{
          sermon_id: id,
          user_id: user.id,
          start_time_ms: selectedTimeRange.start,
          end_time_ms: selectedTimeRange.end,
          comment_text: commentText,
          audio_url: audioUrl,
        }]);

      if (error) throw error;

      toast({ title: "Comment added successfully" });
      setCommentDialogOpen(false);
      setNewComment("");
      setAudioBlob(null);
      
      // Seek to the next sentence so spacebar resumes past the comment
      if (audioUrl) {
        const nextSentence = sentences.find(s => s.start_time_ms > selectedTimeRange.start);
        if (nextSentence && audioRef.current) {
          audioRef.current.currentTime = nextSentence.start_time_ms / 1000;
          lastTimeRef.current = nextSentence.start_time_ms;
        }
      }
      
      fetchComments();
    } catch (error: any) {
      setTranscribing(false);
      toast({
        title: "Error adding comment",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handlePreviewParagraph = async (paragraphIndex: number) => {
    const paragraph = groupIntoParagraphs(sentences)[paragraphIndex];
    if (!paragraph || !audioRef.current) return;

    const firstSentence = paragraph[0];
    const lastSentence = paragraph[paragraph.length - 1];
    
    setPreviewingParagraph(paragraphIndex);
    
    // Pause any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }

    // Get comments for this paragraph
    const paragraphComments = comments.filter(
      c => c.audio_url && c.start_time_ms >= firstSentence.start_time_ms && c.end_time_ms <= lastSentence.end_time_ms
    ).sort((a, b) => a.start_time_ms - b.start_time_ms);

    if (paragraphComments.length === 0) {
      // No audio comments, just play the sermon section
      audioRef.current.currentTime = firstSentence.start_time_ms / 1000;
      audioRef.current.play();
      setPlaying(true);
      
      // Stop at end of paragraph
      const checkEnd = setInterval(() => {
        if (audioRef.current && audioRef.current.currentTime * 1000 >= lastSentence.end_time_ms) {
          audioRef.current.pause();
          setPlaying(false);
          setPreviewingParagraph(null);
          clearInterval(checkEnd);
        }
      }, 100);
      
      return;
    }

    try {
      const paragraphStart = firstSentence.start_time_ms / 1000;
      const paragraphEnd = lastSentence.end_time_ms / 1000;
      
      // Function to play a segment of the sermon
      const playSermonSegment = (startTime: number, endTime: number): Promise<void> => {
        return new Promise((resolve) => {
          if (!audioRef.current) {
            resolve();
            return;
          }

          // Ensure sermon audio is ready
          audioRef.current.pause();
          audioRef.current.currentTime = startTime;
          
          const playPromise = audioRef.current.play();
          setPlaying(true);

          const checkEnd = setInterval(() => {
            if (!audioRef.current || audioRef.current.currentTime >= endTime) {
              if (audioRef.current) {
                audioRef.current.pause();
              }
              setPlaying(false);
              clearInterval(checkEnd);
              resolve();
            }
          }, 50);
          
          // Handle play promise rejection
          playPromise?.catch(() => {
            clearInterval(checkEnd);
            setPlaying(false);
            resolve();
          });
        });
      };

      // Function to play a comment audio
      const playCommentAudio = async (audioUrl: string): Promise<void> => {
        // Ensure sermon is fully stopped
        if (audioRef.current) {
          audioRef.current.pause();
          setPlaying(false);
        }
        
        return new Promise(async (resolve) => {
          const { data: urlData } = await supabase.storage
            .from("sermon-comments-audio")
            .createSignedUrl(audioUrl, 3600);
          
          if (!urlData?.signedUrl) {
            resolve();
            return;
          }

          const audio = new Audio(urlData.signedUrl);
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          
          try {
            await audio.play();
          } catch (error) {
            resolve();
          }
        });
      };

      // Play segments sequentially - inserting comments, not replacing sermon sections
      let currentTime = paragraphStart;

      for (const comment of paragraphComments) {
        // Skip comments without audio
        if (!comment.audio_url) {
          continue;
        }
        
        const commentStart = comment.start_time_ms / 1000;
        
        // Play sermon segment up to this comment
        if (commentStart > currentTime) {
          await playSermonSegment(currentTime, commentStart);
          await new Promise(resolve => setTimeout(resolve, 300)); // Gap before commentary
        }

        // Ensure sermon is fully stopped before playing comment
        if (audioRef.current) {
          audioRef.current.pause();
          setPlaying(false);
        }

        // Play the comment audio (inserted at this point)
        await playCommentAudio(comment.audio_url);
        await new Promise(resolve => setTimeout(resolve, 300)); // Gap after commentary

        // Advance currentTime past this comment to prevent getting stuck
        currentTime = Math.max(currentTime, commentStart + 0.001);
      }

      // Play remaining sermon segment after last comment
      if (currentTime < paragraphEnd) {
        await playSermonSegment(currentTime, paragraphEnd);
      }

      setPreviewingParagraph(null);

    } catch (error: any) {
      console.error("Preview error:", error);
      toast({
        title: "Preview failed",
        description: error.message,
        variant: "destructive",
      });
      setPreviewingParagraph(null);
    }
  };

  const handleExportAudio = async () => {
    if (!sermon || !audioUrl) {
      toast({
        title: "Error",
        description: "Sermon audio not loaded",
        variant: "destructive",
      });
      return;
    }

    setCombiningAudio(true);
    setCombineProgress(0);
    setCombineStatus("Starting...");

    try {
      // Get authenticated URLs for audio comments
      const audioComments: { url: string; timestamp: number }[] = [];
      
      for (const comment of comments.filter(c => c.audio_url)) {
        const { data: urlData } = await supabase.storage
          .from("sermon-comments-audio")
          .createSignedUrl(comment.audio_url!, 3600);
        
        if (urlData?.signedUrl) {
          audioComments.push({
            url: urlData.signedUrl,
            timestamp: comment.start_time_ms
          });
        }
      }

      if (audioComments.length === 0) {
        throw new Error("No audio comments found");
      }

      // Combine audio on client side
      const combinedBlob = await combineAudioFiles(
        audioUrl,
        audioComments,
        (progress, status) => {
          setCombineProgress(progress);
          setCombineStatus(status);
        }
      );

      // Download the combined audio
      const url = URL.createObjectURL(combinedBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sermon.title || 'sermon'}_combined.mp3`;
      link.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Combined audio downloaded successfully",
      });
    } catch (error: any) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCombiningAudio(false);
      setCombineProgress(0);
      setCombineStatus("");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase
        .from("sermon_comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;

      toast({ title: "Comment deleted" });
      fetchComments();
    } catch (error: any) {
      toast({
        title: "Error deleting comment",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const [transcribingCommentId, setTranscribingCommentId] = useState<string | null>(null);

  const handleTranscribeComment = async (comment: Comment) => {
    if (!comment.audio_url) return;

    setTranscribingCommentId(comment.id);
    try {
      // Download the audio file
      const { data: audioData, error: downloadError } = await supabase.storage
        .from("sermon-comments-audio")
        .download(comment.audio_url);

      if (downloadError || !audioData) {
        throw new Error("Failed to download audio");
      }

      // Create form data for transcription
      const formData = new FormData();
      formData.append('audio', audioData, 'audio.webm');

      const transcribeResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio-comment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: formData,
        }
      );

      if (!transcribeResponse.ok) {
        const errorData = await transcribeResponse.json();
        throw new Error(errorData.error || "Transcription failed");
      }

      const { text } = await transcribeResponse.json();

      // Update the comment with the transcription
      const { error: updateError } = await supabase
        .from("sermon_comments")
        .update({ comment_text: text })
        .eq("id", comment.id);

      if (updateError) throw updateError;

      toast({ title: "Transcription complete" });
      fetchComments();
    } catch (error: any) {
      console.error("Transcription error:", error);
      toast({
        title: "Transcription failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTranscribingCommentId(null);
    }
  };

  const getCommentsForRange = (start: number, end: number) => {
    return comments.filter((c) => {
      // Exclude intro comments (start=0, end=0)
      if (c.start_time_ms === 0 && c.end_time_ms === 0) return false;
      // Check if comment falls within or just after the range (covers gaps between sentences)
      return c.start_time_ms >= start && c.start_time_ms < end;
    });
  };

  const handleExport = async (format: string) => {
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-sermon", {
        body: { sermonId: id, format },
      });

      if (error) throw error;

      const blob = new Blob([data.content], { type: data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Export successful" });
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

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const analyticsData = {
        averageWPM: Math.round(getAverageSpeechRate()),
        fastSpeechCount: countFastSpeechParagraphs(fastSpeechThreshold),
        fastSpeechThreshold,
        slowSpeechCount: countSlowSpeechParagraphs(slowSpeechThreshold),
        slowSpeechThreshold,
        verbalPausesCount: countVerbalPauses(),
        insiderLanguageCount: countInsiderLanguage(),
        topFillerWords: getTopFillerWords().map(fw => ({ word: fw.word, count: fw.count })),
        topInsiderTerms: getTopInsiderTerms().map(t => ({ word: t.word, count: t.count })),
      };

      const { data, error } = await supabase.functions.invoke("generate-sermon-report", {
        body: { 
          sermonId: id, 
          analyticsData,
          scriptureRefs,
        },
      });

      if (error) throw error;

      const blob = new Blob([data.content], { type: data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Report exported successfully" });
    } catch (error: any) {
      toast({
        title: "Report export failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!sermon) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Sermon not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-surface">
      <div className="container py-8 animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="h-10 text-2xl font-bold w-80"
                    placeholder="Sermon title"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTitle();
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                  />
                  <Button size="icon" variant="ghost" onClick={handleSaveTitle}>
                    <Check className="h-5 w-5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditingTitle(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-3xl font-bold text-foreground">{sermon.title || "Untitled Sermon"}</h1>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      setTitleInput(sermon.title || "");
                      setEditingTitle(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <Badge variant="secondary" className="mt-2">
                {sermon.transcription_status}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleExportAudio}
              disabled={combiningAudio || comments.filter(c => c.audio_url).length === 0}
            >
              {combiningAudio ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export Combined Audio
            </Button>
            <Button
              variant="outline"
              onClick={() => setEvaluationDialogOpen(true)}
              disabled={rules.length === 0}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Evaluate
            </Button>
            <Button
              variant="outline"
              onClick={() => setViewMode(viewMode === "sentence" ? "paragraph" : "sentence")}
            >
              {viewMode === "sentence" ? <AlignLeft className="mr-2 h-4 w-4" /> : <List className="mr-2 h-4 w-4" />}
              {viewMode === "sentence" ? "Paragraph View" : "Sentence View"}
            </Button>
          </div>
        </div>

        {previewingParagraph !== null && (
          <Card className="mb-6 p-4 border-primary bg-primary/5">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm font-medium">Playing paragraph with commentary...</p>
            </div>
          </Card>
        )}

        {/* Audio Editor */}
        {showAudioEditor && sermon && audioUrl && (
          <AudioEditor
            audioUrl={audioUrl}
            fileUrl={sermon.file_url}
            sermonId={sermon.id}
            durationMs={(sermon.duration_seconds || 0) * 1000}
            onClose={() => setShowAudioEditor(false)}
            onSave={() => {
              setShowAudioEditor(false);
              // Refresh sermon data
              fetchSermon();
            }}
          />
        )}

        <Card className="mb-6 p-6 shadow-md border-border/50">
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Button 
                size="icon" 
                onClick={togglePlayPause} 
                disabled={previewingParagraph !== null || showAudioEditor}
                className={`${playing ? 'pause-button' : 'play-button'} h-12 w-12 text-primary-foreground`}
              >
                {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAudioEditor(!showAudioEditor)}
                disabled={previewingParagraph !== null}
              >
                <Scissors className="h-4 w-4 mr-2" />
                {showAudioEditor ? "Close Editor" : "Edit Audio"}
              </Button>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={async () => {
                  if (audioRef.current) {
                    stopCommentAudio();
                    setPlayedCommentIds(new Set());
                    audioRef.current.currentTime = 0;
                    
                    // Check if there's an intro comment (at time 0 or before first sentence)
                    const firstSentenceStart = sentences.length > 0 ? sentences[0].start_time_ms : 0;
                    const introComment = comments.find(c => c.audio_url && c.start_time_ms <= firstSentenceStart);
                    if (introComment) {
                      // Play the intro comment first
                      audioRef.current.pause();
                      setPlayingCommentId(introComment.id);
                      setPlayedCommentIds(new Set([introComment.id]));
                      
                      let url = commentSignedUrls[introComment.id];
                      if (!url) {
                        const { data } = await supabase.storage
                          .from("sermon-comments-audio")
                          .createSignedUrl(introComment.audio_url!, 3600);
                        if (data?.signedUrl) {
                          url = data.signedUrl;
                          setCommentSignedUrls(prev => ({ ...prev, [introComment.id]: url }));
                        }
                      }
                      
                      if (url) {
                        const audio = new Audio(url);
                        commentAudioRef.current = audio;
                        let handled = false;
                        const cleanup = () => {
                          if (handled) return;
                          handled = true;
                          setPlayingCommentId(null);
                          commentAudioRef.current = null;
                          if (audioRef.current) {
                            audioRef.current.play().catch(() => {});
                          }
                        };
                        audio.onended = cleanup;
                        audio.onerror = (e) => {
                          const mediaError = audio.error;
                          if (mediaError && mediaError.code !== MediaError.MEDIA_ERR_ABORTED) {
                            cleanup();
                          }
                        };
                        try {
                          await audio.play();
                        } catch (err: any) {
                          if (err.name !== 'AbortError') {
                            cleanup();
                          }
                        }
                      } else {
                        setPlayingCommentId(null);
                        audioRef.current.play().catch(() => {});
                      }
                    } else {
                      audioRef.current.play().catch(() => {});
                    }
                  }
                }}
                disabled={previewingParagraph !== null}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Play from start
              </Button>
              
              <div className="flex items-center gap-1 border-l pl-4">
                <span className="text-sm text-muted-foreground">Zoom:</span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => {
                    const levels = [0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
                    const idx = levels.indexOf(zoomLevel);
                    if (idx > 0) { setZoomLevel(levels[idx - 1]); setViewStart(0); }
                  }}
                  disabled={zoomLevel <= 0.75}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-[5rem]">
                      {zoomLevel}x
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => { setZoomLevel(0.75); setViewStart(0); }}>
                      0.75x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(1); setViewStart(0); }}>
                      1x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(1.25); setViewStart(0); }}>
                      1.25x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(1.5); setViewStart(0); }}>
                      1.5x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(2); setViewStart(0); }}>
                      2x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(3); setViewStart(0); }}>
                      3x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(4); setViewStart(0); }}>
                      4x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(6); setViewStart(0); }}>
                      6x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setZoomLevel(8); setViewStart(0); }}>
                      8x
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => {
                    const levels = [0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
                    const idx = levels.indexOf(zoomLevel);
                    if (idx < levels.length - 1) { setZoomLevel(levels[idx + 1]); setViewStart(0); }
                  }}
                  disabled={zoomLevel >= 8}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                {zoomLevel !== 1 && (
                  <Button 
                    size="icon" 
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => {
                      setZoomLevel(1);
                      setViewStart(0);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <div className="flex items-center gap-2 border-l pl-4">
                <span className="text-sm text-muted-foreground">Speed:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-[4rem]">
                      {playbackRate}x
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setPlaybackRate(0.5)}>
                      0.5x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPlaybackRate(0.75)}>
                      0.75x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPlaybackRate(1)}>
                      1x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPlaybackRate(1.25)}>
                      1.25x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPlaybackRate(1.5)}>
                      1.5x
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPlaybackRate(2)}>
                      2x
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-2 border-l pl-4">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col gap-1 min-w-[120px]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16">Sermon:</span>
                    <Slider
                      value={[sermonVolume * 100]}
                      onValueChange={([v]) => setSermonVolume(v / 100)}
                      max={100}
                      step={5}
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground w-8">{Math.round(sermonVolume * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16">Comments:</span>
                    <Slider
                      value={[commentVolume * 100]}
                      onValueChange={([v]) => setCommentVolume(v / 100)}
                      max={100}
                      step={5}
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground w-8">{Math.round(commentVolume * 100)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 border-l pl-4">
                {timeSinceLastCommentInAudio !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Since last comment:</span>
                    <span className="text-sm font-medium font-mono">
                      {Math.floor(timeSinceLastCommentInAudio / 60)}:{String(timeSinceLastCommentInAudio % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Comments:</span>
                  <span className="text-sm font-medium">{comments.length}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 border-l pl-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="max-w-[200px]">
                      <Mic className="mr-2 h-4 w-4 shrink-0" />
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


              {comments.filter(c => c.audio_url).length > 0 && (
                <div className="flex items-center gap-2 border-l pl-4">
                  <Switch
                    id="preview-comments"
                    checked={previewWithComments}
                    onCheckedChange={setPreviewWithComments}
                  />
                  <label 
                    htmlFor="preview-comments" 
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    Preview with comments
                  </label>
                  {playingCommentId && (
                    <Badge variant="secondary" className="animate-pulse">
                      <Mic className="h-3 w-3 mr-1" />
                      Playing comment
                    </Badge>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex-1 space-y-2">
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onSeeked={handleSeeked}
                onPlay={() => setPlaying(true)}
                onPause={handleAudioPause}
              />
                
                {/* Timeline with sermon and comment segments */}
                <div 
                  className={`timeline-track relative h-48 overflow-x-auto custom-scrollbar ${isDraggingTimeline ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onWheel={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      const levels = [0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
                      const idx = levels.indexOf(zoomLevel);
                      if (e.deltaY < 0 && idx < levels.length - 1) {
                        setZoomLevel(levels[idx + 1]);
                      } else if (e.deltaY > 0 && idx > 0) {
                        setZoomLevel(levels[idx - 1]);
                      }
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    const container = e.currentTarget;
                    dragStartRef.current = { x: e.clientX, scrollLeft: container.scrollLeft };
                    setIsDraggingTimeline(false);
                  }}
                  onMouseMove={(e) => {
                    const container = e.currentTarget;
                    
                    // Handle dragging
                    if (dragStartRef.current && e.buttons === 1) {
                      const dx = e.clientX - dragStartRef.current.x;
                      if (Math.abs(dx) > 3) {
                        setIsDraggingTimeline(true);
                        container.scrollLeft = dragStartRef.current.scrollLeft + dx;
                      }
                    }
                    
                    // Hover tooltip
                    if (!sermon.duration_seconds) return;
                    const rect = container.getBoundingClientRect();
                    const hoverX = e.clientX - rect.left + container.scrollLeft;
                    const totalWidth = rect.width * zoomLevel;
                    const percentage = hoverX / totalWidth;
                    const timeMs = percentage * sermon.duration_seconds * 1000;
                    const positionPercent = (hoverX / totalWidth) * 100;
                    setHoverTime(timeMs);
                    setHoverPosition(positionPercent);
                  }}
                  onMouseUp={(e) => {
                    // Only seek if it was a click (not a drag)
                    if (!isDraggingTimeline && sermon.duration_seconds) {
                      const container = e.currentTarget;
                      const rect = container.getBoundingClientRect();
                      const clickX = e.clientX - rect.left + container.scrollLeft;
                      const totalWidth = rect.width * zoomLevel;
                      const percentage = clickX / totalWidth;
                      const newTime = percentage * sermon.duration_seconds * 1000;
                      seekTo(newTime);
                    }
                    dragStartRef.current = null;
                    setIsDraggingTimeline(false);
                  }}
                  onMouseLeave={() => {
                    dragStartRef.current = null;
                    setIsDraggingTimeline(false);
                    setHoverTime(null);
                    setHoverPosition(null);
                  }}
                >
                  <div style={{ width: `${zoomLevel * 100}%`, position: 'relative', height: '100%' }}>
                    {/* Hover timestamp tooltip */}
                    {hoverTime !== null && hoverPosition !== null && (
                      <div 
                        className="absolute z-20 bottom-full mb-2 px-2 py-1 bg-foreground text-background text-xs rounded shadow-lg pointer-events-none whitespace-nowrap"
                        style={{
                          left: `${hoverPosition}%`,
                          transform: 'translateX(-50%)',
                        }}
                      >
                        {Math.floor(hoverTime / 1000 / 60)}:{String(Math.floor((hoverTime / 1000) % 60)).padStart(2, "0")}
                      </div>
                    )}
                    {/* Hover vertical line indicator */}
                    {hoverTime !== null && hoverPosition !== null && (
                      <div 
                        className="absolute z-10 top-0 bottom-0 w-px bg-foreground/50 pointer-events-none"
                        style={{
                          left: `${hoverPosition}%`,
                        }}
                      />
                    )}
                    {/* Waveform visualization */}
                    {waveformData.length > 0 && (
                      <div className="absolute inset-0 flex items-center">
                        {waveformData.map((amplitude, idx) => {
                          const barPosition = (idx / waveformData.length) * 100;
                          const isPlayed = sermon.duration_seconds && 
                            (barPosition / 100) * sermon.duration_seconds * 1000 < currentTime;
                          
                          return (
                            <div
                              key={idx}
                              className={`waveform-bar absolute ${isPlayed ? 'waveform-bar-played' : ''}`}
                              style={{
                                width: '3px',
                                height: `${Math.max(amplitude * 100, 8)}%`,
                                left: `${barPosition}%`,
                                transform: 'translateX(-50%)',
                              }}
                            />
                          );
                        })}
                      </div>
                    )}

                  {/* Sermon segments (green) and comment segments (red) */}
                  {sermon.duration_seconds && (() => {
                    const totalDuration = sermon.duration_seconds * 1000;
                    const sortedComments = [...comments]
                      .filter(c => c.audio_url) // Include all comments with audio (including intro)
                      .sort((a, b) => a.start_time_ms - b.start_time_ms);
                    
                    const segments: Array<{ start: number; end: number; type: 'sermon' | 'comment' | 'fast-speech'; comment?: Comment }> = [];
                    let currentPos = 0;
                    
                    // Get fast speech paragraphs
                    const paragraphs = groupIntoParagraphs(sentences);
                    const fastSpeechRanges = paragraphs
                      .filter(p => hasFastSpeechRate(p, fastSpeechThreshold))
                      .map(p => ({
                        start: p[0].start_time_ms,
                        end: p[p.length - 1].end_time_ms
                      }));
                    
                    sortedComments.forEach(comment => {
                      // Add sermon segment before comment
                      if (comment.start_time_ms > currentPos) {
                        segments.push({
                          start: currentPos,
                          end: comment.start_time_ms,
                          type: 'sermon'
                        });
                      }
                      // Add comment segment
                      segments.push({
                        start: comment.start_time_ms,
                        end: comment.start_time_ms, // Comments are insertions, not replacements
                        type: 'comment',
                        comment
                      });
                      currentPos = comment.start_time_ms;
                    });
                    
                    // Add final sermon segment
                    if (currentPos < totalDuration) {
                      segments.push({
                        start: currentPos,
                        end: totalDuration,
                        type: 'sermon'
                      });
                    }
                    
                    return (
                      <>
                        {/* Only show commentary insertions, not sermon segments */}
                        {segments.filter(s => s.type === 'comment').map((segment, idx) => {
                          const left = (segment.start / totalDuration) * 100;
                          
                          return (
                            <div
                              key={idx}
                              className="comment-marker absolute h-full"
                              style={{
                                left: `${left}%`,
                                width: '4px',
                              }}
                              title={`Commentary at ${Math.floor(segment.start / 1000 / 60)}:${String(Math.floor((segment.start / 1000) % 60)).padStart(2, "0")}`}
                            >
                              <div className="w-full h-full bg-gradient-warm rounded-full shadow-glow-accent" />
                            </div>
                          );
                        })}
                        
                        {/* Fast speech overlays */}
                        {showFastSpeech && fastSpeechRanges.map((range, idx) => {
                          const left = (range.start / totalDuration) * 100;
                          const width = ((range.end - range.start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`fast-${idx}`}
                              className="absolute h-full bg-fuchsia-500/50 border-t-2 border-b-2 border-fuchsia-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Fast speech at ${Math.floor(range.start / 1000 / 60)}:${String(Math.floor((range.start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                        
                        {/* Filler word overlays */}
                        {getTopFillerWords().map((filler) => {
                          if (!visibleFillerWords.has(filler.word)) return null;
                          
                          return getFillerWordTimestamps(filler.word).map((timestamp, idx) => {
                            const left = (timestamp.start / totalDuration) * 100;
                            const width = ((timestamp.end - timestamp.start) / totalDuration) * 100;
                            
                            return (
                              <div
                                key={`filler-${filler.word}-${idx}`}
                                className="absolute h-full border-t-2 border-b-2"
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  backgroundColor: `${filler.color}50`,
                                  borderColor: filler.color,
                                }}
                                title={`"${filler.word}" at ${Math.floor(timestamp.start / 1000 / 60)}:${String(Math.floor((timestamp.start / 1000) % 60)).padStart(2, "0")}`}
                              />
                            );
                          });
                        })}
                        
                        {/* Slow speech overlays */}
                        {showSlowSpeech && getSlowSpeechParagraphs(slowSpeechThreshold).map((paragraph, idx) => {
                          const start = paragraph[0].start_time_ms;
                          const end = paragraph[paragraph.length - 1].end_time_ms;
                          const left = (start / totalDuration) * 100;
                          const width = ((end - start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`slow-${idx}`}
                              className="absolute h-full bg-cyan-500/50 border-t-2 border-b-2 border-cyan-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Slow speech at ${Math.floor(start / 1000 / 60)}:${String(Math.floor((start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                        
                        {/* Volume change overlays */}
                        {showVolumeChanges && getVolumeChangeParagraphs().map((paragraph, idx) => {
                          const start = paragraph[0].start_time_ms;
                          const end = paragraph[paragraph.length - 1].end_time_ms;
                          const left = (start / totalDuration) * 100;
                          const width = ((end - start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`volume-${idx}`}
                              className="absolute h-full bg-amber-500/50 border-t-2 border-b-2 border-amber-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Volume change at ${Math.floor(start / 1000 / 60)}:${String(Math.floor((start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                        
                        {/* Silent pause overlays */}
                        {showSilentPauses && getSilentPauseTimestamps().map((pause, idx) => {
                          const left = (pause.start / totalDuration) * 100;
                          const width = ((pause.end - pause.start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`silent-${idx}`}
                              className="absolute h-full bg-blue-500/50 border-t-2 border-b-2 border-blue-600"
                              style={{
                                left: `${left}%`,
                                width: `${Math.max(width, 0.3)}%`,
                              }}
                              title={`${(pause.durationMs / 1000).toFixed(1)}s pause at ${Math.floor(pause.start / 1000 / 60)}:${String(Math.floor((pause.start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                        
                        {/* Insider language overlays */}
                        {getTopInsiderTerms().map((term) => {
                          if (!visibleInsiderTerms.has(term.word)) return null;
                          
                          return getInsiderTermTimestamps(term.word).map((timestamp, idx) => {
                            const left = (timestamp.start / totalDuration) * 100;
                            const width = ((timestamp.end - timestamp.start) / totalDuration) * 100;
                            
                            return (
                              <div
                                key={`insider-${term.word}-${idx}`}
                                className="absolute h-full border-t-2 border-b-2"
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  backgroundColor: `${term.color}50`,
                                  borderColor: term.color,
                                }}
                                title={`"${term.word}" at ${Math.floor(timestamp.start / 1000 / 60)}:${String(Math.floor((timestamp.start / 1000) % 60)).padStart(2, "0")}`}
                              />
                            );
                          });
                        })}
                        
                        {/* Scripture reference overlays - sentence-level precision */}
                        {showScriptureRefs && scriptureRefs && sentences.map((sentence, idx) => {
                          // Check if this specific sentence contains scripture text
                          const hasScripture = scriptureRefs.references.some(ref => {
                            const contextWords = ref.context.split(' ').slice(0, 10).join(' ');
                            return sentence.sentence_text.includes(contextWords) || sentence.sentence_text.includes(ref.reference);
                          });
                          if (!hasScripture) return null;
                          
                          const left = (sentence.start_time_ms / totalDuration) * 100;
                          const width = ((sentence.end_time_ms - sentence.start_time_ms) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`scripture-${idx}`}
                              className="absolute h-full bg-emerald-500/50 border-t-2 border-b-2 border-emerald-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Scripture at ${Math.floor(sentence.start_time_ms / 1000 / 60)}:${String(Math.floor((sentence.start_time_ms / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}

                        {/* Confusing phrases overlays */}
                        {showConfusingPhrases && confusingPhrases && confusingPhrases.phrases.map((phrase, idx) => {
                          const left = (phrase.start_time_ms / totalDuration) * 100;
                          const width = ((phrase.end_time_ms - phrase.start_time_ms) / totalDuration) * 100;
                          const severityColor = phrase.severity === 'severe' ? '#ef4444' : phrase.severity === 'moderate' ? '#f97316' : '#eab308';
                          
                          return (
                            <div
                              key={`confusing-${idx}`}
                              className="absolute h-full border-t-2 border-b-2"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                backgroundColor: `${severityColor}40`,
                                borderColor: severityColor,
                              }}
                              title={`⚠️ "${phrase.phrase}" - ${phrase.reason}`}
                            />
                          );
                        })}

                        {/* Question overlays */}
                        {showQuestions && sentences.map((sentence, idx) => {
                          if (!sentence.sentence_text.trim().endsWith('?')) return null;
                          if (isSentenceInScripture(sentence.sentence_text, idx)) return null;
                          if (congregationQuestionIndices && !congregationQuestionIndices.has(idx)) return null;
                          const left = (sentence.start_time_ms / totalDuration) * 100;
                          const width = ((sentence.end_time_ms - sentence.start_time_ms) / totalDuration) * 100;
                          return (
                            <div
                              key={`question-${idx}`}
                              className="absolute h-full border-t-2 border-b-2 border-amber-500 bg-amber-500/30"
                              style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                              title={`❓ ${sentence.sentence_text}`}
                            />
                          );
                        })}
                      </>
                    );
                  })()}
                  
                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-gradient-primary z-10 rounded-full shadow-glow-primary progress-glow"
                    style={{
                      left: sermon.duration_seconds
                        ? `${(currentTime / (sermon.duration_seconds * 1000)) * 100}%`
                        : "0%",
                    }}
                  >
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-gradient-primary rounded-full shadow-lg border-2 border-background" />
                  </div>
                </div>
              </div>

              {/* Time display */}
              <div className="flex justify-between text-sm">
                <span className="font-mono text-foreground font-medium">
                  {Math.floor(currentTime / 1000 / 60)}:
                  {String(Math.floor((currentTime / 1000) % 60)).padStart(2, "0")}
                </span>
                <span className="text-muted-foreground">
                  {sermon.duration_seconds 
                    ? `-${Math.floor((sermon.duration_seconds * 1000 - currentTime) / 1000 / 60)}:${String(Math.floor(((sermon.duration_seconds * 1000 - currentTime) / 1000) % 60)).padStart(2, "0")}`
                    : "-0:00"
                  }
                </span>
                <span className="font-mono text-muted-foreground">
                  {sermon.duration_seconds 
                    ? `${Math.floor(sermon.duration_seconds / 60)}:${String(Math.floor(sermon.duration_seconds % 60)).padStart(2, "0")}`
                    : "0:00"
                  }
                </span>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-0.5 h-4 bg-red-500" />
                <span>Commentary Insertion</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-2 bg-fuchsia-500/50 border-t border-b border-fuchsia-600 rounded" />
                <span>Fast Speech</span>
              </div>
              {getTopFillerWords().map((filler) => (
                <div key={filler.word} className="flex items-center gap-2">
                  <div 
                    className="w-4 h-2 border-t border-b rounded" 
                    style={{
                      backgroundColor: `${filler.color}50`,
                      borderColor: filler.color
                    }}
                  />
                  <span className="capitalize">{filler.word}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <div className="w-4 h-2 bg-cyan-500/50 border-t border-b border-cyan-600 rounded" />
                <span>Slow Speech</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-2 bg-amber-500/50 border-t border-b border-amber-600 rounded" />
                <span>Volume Changes</span>
              </div>
              {getTopInsiderTerms().map((term) => (
                <div key={term.word} className="flex items-center gap-2">
                  <div 
                    className="w-4 h-2 border-t border-b rounded" 
                    style={{
                      backgroundColor: `${term.color}50`,
                      borderColor: term.color
                    }}
                  />
                  <span className="capitalize">{term.word}</span>
                </div>
              ))}
              {showScriptureRefs && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-2 bg-emerald-500/50 border-t border-b border-emerald-600 rounded" />
                  <span>Scripture References</span>
                </div>
              )}
              {showConfusingPhrases && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-2 bg-red-500/40 border-t border-b border-red-500 rounded" />
                  <span>Insider Language</span>
                </div>
              )}
              {showQuestions && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-2 bg-amber-500/50 border-t border-b border-amber-600 rounded" />
                  <span>Questions</span>
                </div>
              )}
            </div>
          </div>

          {combiningAudio && (
            <div className="mt-4 space-y-2">
              <Progress value={combineProgress} />
              <p className="text-sm text-muted-foreground text-center">{combineStatus}</p>
            </div>
          )}
        </Card>

        {/* Sermon Dashboard */}
        <Card className="mb-6 p-6 shadow-lg animate-slide-up">
          <h2 className="text-xl font-semibold mb-4 text-gradient-primary">Sermon Analytics</h2>
          {/* Engagement Score Card - Full Width */}
          <Card className="stats-card p-4 mb-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-bold text-amber-700">Engagement Score</h3>
              <div className="flex gap-2">
                {loadingIllustrations && (
                  <span className="flex items-center text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Analyzing stories...
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => setEngagementExpanded(!engagementExpanded)}
                >
                  {engagementExpanded ? "Collapse" : "Details"}
                </Button>
              </div>
            </div>
            <div className="flex flex-col items-center text-center mb-3">
              <div className="text-4xl font-bold text-amber-600">
                <AnimatedCounter value={getEngagementScore().total} /><span className="text-lg text-muted-foreground">/10</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Overall Engagement{!illustrationData && " (without story analysis)"}
              </div>
            </div>
            {engagementExpanded && (
              <div className="space-y-2 border-t pt-3">
                {getEngagementScore().subscores.map((sub) => (
                  <div key={sub.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5">
                      <span>{sub.icon}</span>
                      <span>{sub.label}</span>
                      {sub.label === "Illustrations & Stories" && sub.score === 0 && (
                        <span className="text-xs text-muted-foreground italic">(not loaded)</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all ${
                            sub.score >= 7 ? 'bg-emerald-500' : sub.score >= 4 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${(sub.score / 10) * 100}%` }}
                        />
                      </div>
                      <span className={`font-semibold w-6 text-right ${
                        sub.score >= 7 ? 'text-emerald-600' : sub.score >= 4 ? 'text-amber-600' : 'text-red-600'
                      }`}>{sub.score}</span>
                    </div>
                  </div>
                ))}
                {illustrationData && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Story Breakdown:</p>
                    <div className="grid grid-cols-3 gap-2 text-xs text-center">
                      {illustrationData.breakdown.stories > 0 && (
                        <div><div className="font-semibold text-amber-600">{illustrationData.breakdown.stories}</div><div className="text-muted-foreground">Stories</div></div>
                      )}
                      {illustrationData.breakdown.humor > 0 && (
                        <div><div className="font-semibold text-amber-600">{illustrationData.breakdown.humor}</div><div className="text-muted-foreground">Humor</div></div>
                      )}
                      {illustrationData.breakdown.illustrations > 0 && (
                        <div><div className="font-semibold text-amber-600">{illustrationData.breakdown.illustrations}</div><div className="text-muted-foreground">Illustrations</div></div>
                      )}
                      {illustrationData.breakdown.audience_interactions > 0 && (
                        <div><div className="font-semibold text-amber-600">{illustrationData.breakdown.audience_interactions}</div><div className="text-muted-foreground">Crowd Work</div></div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="stats-card p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-primary">Words Per Minute</h3>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-4xl font-bold text-gradient-primary">
                  <AnimatedCounter value={Math.round(getAverageSpeechRate())} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Average WPM
                </div>
              </div>
              {/* WPM Sparkline */}
              <div className="flex justify-center mt-2 mb-1">
                <Sparkline 
                  data={getWpmTimelineData().map(d => d.wpm)} 
                  color="hsl(var(--primary))" 
                  showAvgLine 
                  width={140} 
                  height={28} 
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-center border-t pt-3">
                <div>
                  <div className="font-semibold text-primary">{Math.round(getSpeedVariance().min)}</div>
                  <div className="text-muted-foreground">Min</div>
                </div>
                <div>
                  <div className="font-semibold text-primary">{Math.round(getSpeedVariance().max)}</div>
                  <div className="text-muted-foreground">Max</div>
                </div>
                <div>
                  <div className="font-semibold text-primary">±{Math.round(getSpeedVariance().stdDev)}</div>
                  <div className="text-muted-foreground">Std Dev</div>
                </div>
              </div>
            </Card>

            <Card className="stats-card p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-rose-700">Speed Transitions</h3>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl font-bold text-rose-600">
                  <AnimatedCounter value={countSpeedTransitions(20)} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Pace Changes (20+ WPM)
                </div>
              </div>
              {/* Speed Transitions Sparkline - show WPM deltas */}
              <div className="flex justify-center mt-2 mb-1">
                <Sparkline 
                  data={(() => {
                    const wpm = getWpmTimelineData().map(d => d.wpm);
                    return wpm.slice(1).map((v, i) => Math.abs(v - wpm[i]));
                  })()}
                  color="#e11d48"
                  width={140} 
                  height={28} 
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-center border-t pt-3">
                <div>
                  <div className="font-semibold text-rose-600">{countSpeedTransitions(10)}</div>
                  <div className="text-muted-foreground">10+ WPM</div>
                </div>
                <div>
                  <div className="font-semibold text-rose-600">{countSpeedTransitions(30)}</div>
                  <div className="text-muted-foreground">30+ WPM</div>
                </div>
                <div>
                  <div className="font-semibold text-rose-600">{countSpeedTransitions(40)}</div>
                  <div className="text-muted-foreground">40+ WPM</div>
                </div>
              </div>
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowFastSpeech(!showFastSpeech)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-fuchsia-700">Fast Speech</h3>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                        View All
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-background border shadow-lg z-50">
                      {[1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2.0].map((threshold) => (
                        <DropdownMenuItem 
                          key={threshold}
                          className="flex justify-between cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFastSpeechThreshold(threshold);
                          }}
                        >
                          <span>{threshold.toFixed(2)}x</span>
                          <span className="font-semibold text-fuchsia-600">
                            {countFastSpeechParagraphs(threshold)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Checkbox
                    checked={showFastSpeech}
                    onCheckedChange={(checked) => setShowFastSpeech(checked === true)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-fuchsia-600">
                  <AnimatedCounter value={countFastSpeechParagraphs(fastSpeechThreshold)} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Fast Speech Sections ({fastSpeechThreshold.toFixed(2)}x+)
                </div>
              </div>
              {/* Fast Speech Sparkline - WPM with fast sections highlighted */}
              <div className="flex justify-center mb-2">
                <Sparkline 
                  data={getWpmTimelineData().map(d => d.wpm)} 
                  color="#d946ef" 
                  width={140} 
                  height={28} 
                  showAvgLine
                />
              </div>
              <div className="px-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Threshold</span>
                  <span>{fastSpeechThreshold.toFixed(2)}x</span>
                </div>
                <Slider
                  value={[fastSpeechThreshold]}
                  onValueChange={([value]) => setFastSpeechThreshold(value)}
                  min={1.0}
                  max={2.0}
                  step={0.05}
                  className="w-full"
                />
              </div>
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowSlowSpeech(!showSlowSpeech)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-cyan-700">Slow Speech</h3>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                        View All
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-background border shadow-lg z-50">
                      {[0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5].map((threshold) => (
                        <DropdownMenuItem 
                          key={threshold}
                          className="flex justify-between cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSlowSpeechThreshold(threshold);
                          }}
                        >
                          <span>{threshold.toFixed(2)}x</span>
                          <span className="font-semibold text-cyan-600">
                            {countSlowSpeechParagraphs(threshold)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Checkbox
                    checked={showSlowSpeech}
                    onCheckedChange={(checked) => setShowSlowSpeech(checked === true)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-cyan-600">
                  <AnimatedCounter value={countSlowSpeechParagraphs(slowSpeechThreshold)} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Slow Speech Sections ({slowSpeechThreshold.toFixed(2)}x)
                </div>
              </div>
              {/* Slow Speech Sparkline */}
              <div className="flex justify-center mb-2">
                <Sparkline 
                  data={getWpmTimelineData().map(d => d.wpm)} 
                  color="#06b6d4" 
                  width={140} 
                  height={28} 
                  showAvgLine
                />
              </div>
              <div className="px-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Threshold</span>
                  <span>{slowSpeechThreshold.toFixed(2)}x</span>
                </div>
                <Slider
                  value={[slowSpeechThreshold]}
                  onValueChange={([value]) => setSlowSpeechThreshold(value)}
                  min={0.5}
                  max={1.0}
                  step={0.05}
                  className="w-full"
                />
              </div>
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowVolumeChanges(!showVolumeChanges)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-amber-700">Volume Changes</h3>
                <Checkbox
                  checked={showVolumeChanges}
                  onCheckedChange={(checked) => setShowVolumeChanges(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="grid grid-cols-5 gap-2 w-full px-2">
                  {[-2, -1, 0, 1, 2].map(level => (
                    <div key={level} className="flex flex-col items-center">
                      <div className="text-lg font-bold text-amber-600">
                        {countVolumeChangeParagraphs()[level]}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {level > 0 ? `+${level}` : level}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground mt-2">
                  Volume Shifts by Level
                </div>
              </div>
              {/* Volume Changes Sparkline */}
              <div className="flex justify-center mb-2">
                <Sparkline 
                  data={getVolumeTimelineData().map(d => d.volume)} 
                  color="#f59e0b" 
                  width={140} 
                  height={28} 
                  showAvgLine
                />
              </div>
              <div className="px-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Threshold</span>
                  <span>{volumeChangeThreshold > 0 ? '+' : ''}{volumeChangeThreshold.toFixed(1)}</span>
                </div>
                <Slider
                  value={[volumeChangeThreshold]}
                  onValueChange={([value]) => setVolumeChangeThreshold(value)}
                  min={-2}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
              </div>
            </Card>

            <Card 
              className="stats-card p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-bold text-orange-700">Filler Words</h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                      View All
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto bg-background border shadow-lg z-50">
                    {getAllFillerWords().length === 0 ? (
                      <DropdownMenuItem disabled className="text-muted-foreground">
                        No filler words found
                      </DropdownMenuItem>
                    ) : (
                      getAllFillerWords().map((filler) => (
                        <DropdownMenuItem 
                          key={filler.word}
                          className="flex justify-between cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFillerWord(filler.word);
                          }}
                        >
                          <span className="capitalize truncate mr-2">{filler.word}</span>
                          <span className="font-semibold text-orange-600">{filler.count}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col items-center text-center mb-4">
                <div className="text-3xl font-bold text-orange-600">
                  <AnimatedCounter value={countVerbalPauses()} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Filler Words Used
                </div>
              </div>
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs text-muted-foreground mb-2">
                  <p className="font-medium">Top 3 Overused Words/Phrases:</p>
                  <p className="mt-1 text-xs opacity-80">Consider replacing with intentional pauses</p>
                </div>
                {getTopFillerWords().map((filler) => (
                  <div key={filler.word} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={visibleFillerWords.has(filler.word)}
                        onCheckedChange={() => toggleFillerWord(filler.word)}
                      />
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: filler.color }}
                      />
                      <span className="text-sm capitalize">{filler.word}</span>
                    </div>
                    <span className="text-sm font-medium">{filler.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowSilentPauses(!showSilentPauses)}
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-bold text-blue-700">Use of Silence</h3>
                <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                      View All
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto bg-background border shadow-lg z-50">
                    {getSilentPauseTimestamps().length === 0 ? (
                      <DropdownMenuItem disabled className="text-muted-foreground">
                        No silent pauses found
                      </DropdownMenuItem>
                    ) : (
                      getSilentPauseTimestamps().map((p, idx) => (
                        <DropdownMenuItem
                          key={idx}
                          className="flex justify-between cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (audioRef.current) {
                              audioRef.current.currentTime = p.start / 1000;
                            }
                          }}
                        >
                          <span>{`${Math.floor(p.start / 60000)}:${String(Math.floor((p.start % 60000) / 1000)).padStart(2, '0')}`}</span>
                          <span className="font-semibold text-blue-600">{(p.durationMs / 1000).toFixed(1)}s</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                  <Checkbox
                    checked={showSilentPauses}
                    onCheckedChange={(checked) => setShowSilentPauses(checked === true)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-blue-600">
                  <AnimatedCounter value={countSilentPauses()} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Pauses ≥ 3 seconds
                </div>
              </div>
              {getSilentPauseTimestamps().length > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  Longest: {(Math.max(...getSilentPauseTimestamps().map(p => p.durationMs)) / 1000).toFixed(1)}s
                </div>
              )}
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowScriptureRefs(!showScriptureRefs)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-emerald-700">Scripture References</h3>
                <Checkbox
                  checked={showScriptureRefs}
                  onCheckedChange={(checked) => setShowScriptureRefs(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-emerald-600">
                  {loadingScriptures ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <AnimatedCounter value={scriptureRefs?.total_count || 0} />
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Biblical Citations
                  {!loadingScriptures && scriptureRefs?.total_verses != null && (
                    <span className="block text-xs text-emerald-600 font-medium mt-0.5">
                      ({scriptureRefs.total_verses} total verses)
                    </span>
                  )}
                </div>
              </div>
              {scriptureRefs && scriptureRefs.references.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="text-xs text-muted-foreground mb-2">
                    <p className="font-medium">Scripture References:</p>
                  </div>
                  {scriptureRefs.references.map((ref, idx) => (
                    <div key={idx} className="text-sm border-l-2 border-emerald-500 pl-2 py-1">
                      <div className="font-medium text-emerald-700">
                        {ref.reference}
                        {ref.verse_count != null && (
                          <span className="text-xs font-normal text-muted-foreground ml-1">({ref.verse_count} {ref.verse_count === 1 ? 'verse' : 'verses'})</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {ref.context ? `${ref.context.substring(0, 100)}...` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!scriptureRefs && !loadingScriptures && (
                <div className="text-xs text-center text-muted-foreground">
                  Click to load scripture references
                </div>
              )}
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => {
                if (!confusingPhrases && !loadingConfusing) {
                  fetchConfusingPhrases();
                }
                setShowConfusingPhrases(!showConfusingPhrases);
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-red-700">Insider Language</h3>
                <Checkbox
                  checked={showConfusingPhrases}
                  onCheckedChange={(checked) => setShowConfusingPhrases(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-red-600">
                  {loadingConfusing ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <AnimatedCounter value={confusingPhrases?.total_count || 0} />
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Confusing Phrases
                  {!loadingConfusing && confusingPhrases?.accessibility_score != null && (
                    <span className="block text-xs text-red-600 font-medium mt-0.5">
                      Accessibility: {confusingPhrases.accessibility_score}/10
                    </span>
                  )}
                </div>
              </div>
              {confusingPhrases && confusingPhrases.phrases.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="text-xs text-muted-foreground mb-2">
                    <p className="font-medium">Flagged for first-time visitors:</p>
                  </div>
                  {confusingPhrases.phrases.map((phrase, idx) => (
                    <div key={idx} className="text-sm border-l-2 pl-2 py-1" style={{
                      borderColor: phrase.severity === 'severe' ? '#ef4444' : phrase.severity === 'moderate' ? '#f97316' : '#eab308'
                    }}>
                      <div className="font-medium text-red-700">
                        "{phrase.phrase}"
                        <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0" style={{
                          borderColor: phrase.severity === 'severe' ? '#ef4444' : phrase.severity === 'moderate' ? '#f97316' : '#eab308',
                          color: phrase.severity === 'severe' ? '#ef4444' : phrase.severity === 'moderate' ? '#f97316' : '#eab308',
                        }}>
                          {phrase.severity}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{phrase.reason}</div>
                      <div className="text-xs text-emerald-700 mt-0.5">💡 {phrase.suggestion}</div>
                    </div>
                  ))}
                </div>
              )}
              {!confusingPhrases && !loadingConfusing && (
                <div className="text-xs text-center text-muted-foreground">
                  Click to analyze visitor accessibility
                </div>
              )}
            </Card>

            <Card className="stats-card p-4">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-bold text-teal-700">Repeated Phrases</h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                      View All
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto bg-background border shadow-lg z-50">
                    {getRepeatedPhrases(3).length === 0 ? (
                      <DropdownMenuItem disabled className="text-muted-foreground">
                        No repeated phrases found
                      </DropdownMenuItem>
                    ) : (
                      getRepeatedPhrases(3).map((item) => (
                        <DropdownMenuItem 
                          key={item.word}
                          className="flex justify-between cursor-pointer"
                        >
                          <span className="capitalize truncate mr-2">{item.word}</span>
                          <span className="font-semibold text-teal-600">{item.count}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col items-center text-center mb-4">
                <div className="text-3xl font-bold text-teal-600">
                  <AnimatedCounter value={getRepeatedPhrases(3).length} />
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Phrases Used 3+ Times
                </div>
              </div>
              {getRepeatedPhrases(3).length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="text-xs text-muted-foreground mb-2">
                    <p className="font-medium">Most Repeated Phrases:</p>
                  </div>
                  {getRepeatedPhrases(3).slice(0, 10).map((item) => (
                    <div key={item.word} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{item.word}</span>
                      <span className="font-medium text-teal-600">{item.count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card 
              className="stats-card p-4 cursor-pointer"
              onClick={() => setShowQuestions(!showQuestions)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-amber-700">Questions Asked</h3>
                <Checkbox
                  checked={showQuestions}
                  onCheckedChange={(checked) => setShowQuestions(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-amber-600">
                  {loadingQuestions ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <AnimatedCounter value={sentences.filter((s, sIdx) => {
                      if (!s.sentence_text.trim().endsWith('?')) return false;
                      if (isSentenceInScripture(s.sentence_text, sIdx)) return false;
                      if (congregationQuestionIndices && !congregationQuestionIndices.has(sIdx)) return false;
                      return true;
                    }).length} />
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  to the congregation
                </div>
              </div>
              {!loadingQuestions && (() => {
                const questions = sentences
                  .map((s, sIdx) => ({ s, sIdx }))
                  .filter(({ s, sIdx }) => {
                    if (!s.sentence_text.trim().endsWith('?')) return false;
                    if (isSentenceInScripture(s.sentence_text, sIdx)) return false;
                    if (congregationQuestionIndices && !congregationQuestionIndices.has(sIdx)) return false;
                    return true;
                  });
                return questions.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="text-xs text-muted-foreground mb-2">
                      <p className="font-medium">Questions identified:</p>
                    </div>
                    {questions.map(({ s, sIdx }) => (
                      <div 
                        key={sIdx} 
                        className="text-sm border-l-2 border-amber-500 pl-2 py-1 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-r"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (audioRef.current) {
                            audioRef.current.currentTime = s.start_time_ms / 1000;
                            audioRef.current.play();
                            setPlaying(true);
                          }
                        }}
                      >
                        <div className="text-amber-800 dark:text-amber-300">"{s.sentence_text}"</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {Math.floor(s.start_time_ms / 1000 / 60)}:{String(Math.floor((s.start_time_ms / 1000) % 60)).padStart(2, "0")}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
            </Card>

          </div>

          {/* WPM Timeline Chart */}
          {getWpmTimelineData().length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold mb-3">Speaking Pace Over Time</h3>
              <div className="h-48 w-full cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={getWpmTimelineData()} 
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    onClick={(data) => {
                      if (data?.activePayload?.[0]?.payload?.time !== undefined && audioRef.current) {
                        const timeMs = data.activePayload[0].payload.time;
                        audioRef.current.currentTime = timeMs / 1000;
                        audioRef.current.play();
                        setPlaying(true);
                        setWpmChartClockActive(true);
                      }
                    }}
                  >
                    <XAxis 
                      dataKey="time" 
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tick={{ fontSize: 10 }} 
                      tickFormatter={(ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      tick={{ fontSize: 10 }} 
                      domain={['dataMin - 10', 'dataMax + 10']}
                      width={40}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`${value} WPM`, 'Speed']}
                      labelFormatter={(ms: number) => `Time: ${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <ReferenceLine 
                      y={Math.round(getAverageSpeechRate())} 
                      stroke="hsl(var(--muted-foreground))" 
                      strokeDasharray="5 5"
                      label={{ value: 'Avg', position: 'right', fontSize: 10 }}
                    />
                    {currentTime > 0 && (
                      <ReferenceLine 
                        x={currentTime * 1000}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={3}
                        isFront={true}
                        label={{
                          value: `▼ ${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, '0')}`,
                          position: 'top',
                          fontSize: 11,
                          fontWeight: 'bold',
                          fill: 'hsl(var(--destructive))',
                          offset: 5
                        }}
                      />
                    )}
                    <Line 
                      type="monotone" 
                      dataKey="wpm" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-0.5 bg-primary" />
                  <span>WPM</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-0.5 border-t border-dashed border-muted-foreground" />
                  <span>Average ({Math.round(getAverageSpeechRate())} WPM)</span>
                </div>
              </div>
              {wpmChartClockActive && (
                <div className="text-center mt-2 text-sm font-medium text-primary">
                  ▶ {Math.floor(currentTime / 1000 / 60)}m {String(Math.floor((currentTime / 1000) % 60)).padStart(2, '0')}s
                </div>
              )}
            </div>
          )}

          {/* Volume Timeline Chart */}
          {getVolumeTimelineData().length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold mb-3">Speaking Volume Over Time</h3>
              <div className="h-48 w-full cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={getVolumeTimelineData()} 
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    onClick={(data) => {
                      if (data?.activePayload?.[0]?.payload?.time !== undefined && audioRef.current) {
                        const timeMs = data.activePayload[0].payload.time;
                        audioRef.current.currentTime = timeMs / 1000;
                        audioRef.current.play();
                        setPlaying(true);
                        setVolumeChartClockActive(true);
                      }
                    }}
                  >
                    <XAxis 
                      dataKey="time" 
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tick={{ fontSize: 10 }} 
                      tickFormatter={(ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      tick={{ fontSize: 10 }} 
                      domain={[0, 'dataMax + 20']}
                      width={40}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`${value}%`, 'Volume']}
                      labelFormatter={(ms: number) => `Time: ${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <ReferenceLine 
                      y={100} 
                      stroke="hsl(var(--muted-foreground))" 
                      strokeDasharray="5 5"
                      label={{ value: 'Avg', position: 'right', fontSize: 10 }}
                    />
                    {currentTime > 0 && (
                      <ReferenceLine 
                        x={currentTime * 1000}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={3}
                        isFront={true}
                        label={{
                          value: `▼ ${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, '0')}`,
                          position: 'top',
                          fontSize: 11,
                          fontWeight: 'bold',
                          fill: 'hsl(var(--destructive))',
                          offset: 5
                        }}
                      />
                    )}
                    <Line 
                      type="monotone" 
                      dataKey="volume" 
                      stroke="hsl(var(--chart-3))" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-0.5" style={{ backgroundColor: 'hsl(var(--chart-3))' }} />
                  <span>Volume</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-0.5 border-t border-dashed border-muted-foreground" />
                  <span>Baseline (100%)</span>
                </div>
              </div>
              {volumeChartClockActive && (
                <div className="text-center mt-2 text-sm font-medium text-primary">
                  ▶ {Math.floor(currentTime / 1000 / 60)}m {String(Math.floor((currentTime / 1000) % 60)).padStart(2, '0')}s
                </div>
              )}
            </div>
          )}
          <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen} className="mt-6">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">AI Comment Summary</h3>
                </CollapsibleTrigger>
                <Button
                  onClick={handleSummarizeComments}
                  disabled={summarizing || comments.length === 0}
                  variant="outline"
                  size="sm"
                >
                  {summarizing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {commentSummary ? 'Refresh' : 'Generate'} Summary
                    </>
                  )}
                </Button>
              </div>

              <CollapsibleContent className="space-y-4">
                {commentSummary ? (
                  <>
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <h4 className="font-medium mb-2 text-sm text-muted-foreground">Overall Assessment</h4>
                      <p className="text-sm leading-relaxed">{commentSummary.summary}</p>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground">Key Improvement Areas</h4>
                      <ul className="space-y-2">
                        {commentSummary.bulletPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-3">
                            <Badge variant="outline" className="mt-0.5 shrink-0">
                              {index + 1}
                            </Badge>
                            <span className="text-sm leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Click "Generate Summary" to analyze all comments and get AI-powered improvement suggestions.
                  </p>
                )}
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </Card>

        <div className="flex gap-4">
        {/* Stationary sidebar panel */}
        <div className="sticky top-4 self-start shrink-0 w-44">
          <Card className="p-4 space-y-4">
            {/* Comment count */}
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">{comments.length}</div>
              <div className="text-xs text-muted-foreground">Comments</div>
            </div>
            
            <div className="border-t border-border" />
            
            {/* Time since last comment */}
            <div className="text-center">
              {timeSinceLastCommentInAudio !== null ? (
                <>
                  <div className="text-2xl font-mono font-bold text-foreground">
                    {Math.floor(timeSinceLastCommentInAudio / 60)}:{String(timeSinceLastCommentInAudio % 60).padStart(2, '0')}
                  </div>
                  <div className="text-xs text-muted-foreground">Since last comment</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-mono font-bold text-muted-foreground/50">--:--</div>
                  <div className="text-xs text-muted-foreground">Since last comment</div>
                </>
              )}
            </div>
            
            <div className="border-t border-border" />
            
            {/* Playback speed controls */}
            <div className="text-center space-y-2">
              <div className="text-xs text-muted-foreground">Playback Speed</div>
              <div className="flex items-center justify-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => {
                    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
                    const currentIdx = speeds.indexOf(playbackRate);
                    if (currentIdx > 0) setPlaybackRate(speeds[currentIdx - 1]);
                  }}
                  disabled={playbackRate <= 0.5}
                >
                  <span className="text-xs font-bold">−</span>
                </Button>
                <span className="text-lg font-mono font-bold text-foreground min-w-[3rem]">
                  {playbackRate}x
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => {
                    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
                    const currentIdx = speeds.indexOf(playbackRate);
                    if (currentIdx < speeds.length - 1) setPlaybackRate(speeds[currentIdx + 1]);
                  }}
                  disabled={playbackRate >= 2}
                >
                  <span className="text-xs font-bold">+</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>
        
        <Card className="p-6 flex-1 min-w-0">
          {/* Intro comment section at top */}
          <div className="flex flex-col gap-2 mb-4 pb-4 border-b border-dashed border-border">
            {/* Show existing intro comment if there is one */}
            {comments.filter(c => c.start_time_ms === 0 && c.end_time_ms === 0).map((comment) => (
              <div 
                key={comment.id}
                className="p-3 rounded-lg bg-accent/10 border border-accent/30"
              >
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-xs bg-accent/20">
                    Intro
                  </Badge>
                  <p className="flex-1 text-sm font-bold">{comment.comment_text}</p>
                  {comment.audio_url && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={async (e) => {
                        e.stopPropagation();
                        
                        // If this comment is already playing, toggle pause/play
                        if (playingCommentId === comment.id && commentAudioRef.current) {
                          if (commentAudioRef.current.paused) {
                            commentAudioRef.current.play().catch(() => {});
                          } else {
                            commentAudioRef.current.pause();
                          }
                          return;
                        }
                        
                        // Stop any current audio
                        stopCommentAudio();
                        if (audioRef.current) {
                          audioRef.current.pause();
                        }
                        
                        setPlayingCommentId(comment.id);
                        
                        let url = commentSignedUrls[comment.id];
                        if (!url) {
                          const { data } = await supabase.storage
                            .from("sermon-comments-audio")
                            .createSignedUrl(comment.audio_url!, 3600);
                          if (data?.signedUrl) {
                            url = data.signedUrl;
                            setCommentSignedUrls(prev => ({ ...prev, [comment.id]: url }));
                          }
                        }
                        
                        if (url) {
                          const audio = new Audio(url);
                          commentAudioRef.current = audio;
                          let handled = false;
                          const cleanup = () => {
                            if (handled) return;
                            handled = true;
                            setPlayingCommentId(null);
                            commentAudioRef.current = null;
                          };
                          audio.onended = cleanup;
                          audio.onerror = () => {
                            const mediaError = audio.error;
                            if (mediaError && mediaError.code !== MediaError.MEDIA_ERR_ABORTED) {
                              cleanup();
                            }
                          };
                          try {
                            await audio.play();
                          } catch (err: any) {
                            if (err.name !== 'AbortError') {
                              cleanup();
                            }
                          }
                        }
                      }}
                    >
                      {playingCommentId === comment.id ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm("Delete this comment?")) {
                        await supabase.from("sermon_comments").delete().eq("id", comment.id);
                        fetchComments();
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            
            {/* Add intro comment button */}
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full h-8 px-4 bg-background shadow-sm border-dashed"
                onClick={() => openCommentDialog(0, 0)}
              >
                <MessageSquare className="h-3 w-3 mr-2" />
                <span className="text-xs">Add intro comment</span>
              </Button>
            </div>
          </div>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto scroll-smooth transcript-parallax" ref={transcriptContainerRef}>
            {viewMode === "sentence" ? (
              sentences.map((sentence) => (
                <div
                  key={sentence.id}
                  className={`p-3 rounded-lg transition-colors cursor-pointer ${
                    isCurrentSentence(sentence)
                      ? "bg-primary/10 border border-primary"
                      : showQuestions && sentence.sentence_text.trim().endsWith('?') && !isSentenceInScripture(sentence.sentence_text, sentences.indexOf(sentence)) && (!congregationQuestionIndices || congregationQuestionIndices.has(sentences.indexOf(sentence)))
                        ? "bg-amber-100 border border-amber-300"
                        : "hover:bg-muted"
                  }`}
                  onClick={() => seekTo(sentence.start_time_ms)}
                >
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-xs">
                      {Math.floor(sentence.start_time_ms / 1000 / 60)}:
                      {String(Math.floor((sentence.start_time_ms / 1000) % 60)).padStart(2, "0")}
                    </Badge>
                    <p className="flex-1">{sentence.sentence_text}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCommentDialog(sentence.start_time_ms, sentence.end_time_ms);
                      }}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  </div>
                  {getCommentsForRange(sentence.start_time_ms, sentence.end_time_ms).map((comment) => (
                    <div
                      key={comment.id}
                      className="mt-2 p-2 rounded"
                      style={{
                        backgroundColor: comment.evaluation_rules?.color
                          ? `${comment.evaluation_rules.color}20`
                          : "hsl(var(--muted))",
                        borderLeft: comment.evaluation_rules?.color
                          ? `3px solid ${comment.evaluation_rules.color}`
                          : "3px solid hsl(var(--border))",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          {comment.evaluation_rules && (
                            <Badge
                              variant="outline"
                              className="mb-1"
                              style={{ borderColor: comment.evaluation_rules.color }}
                            >
                              {comment.evaluation_rules.name}
                            </Badge>
                          )}
                          <p className="text-sm font-bold">{comment.comment_text}</p>
                          {comment.audio_url && comment.comment_text === "Audio comment" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-1"
                              onClick={() => handleTranscribeComment(comment)}
                              disabled={transcribingCommentId === comment.id}
                            >
                              {transcribingCommentId === comment.id ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  Transcribing...
                                </>
                              ) : (
                                <>
                                  <FileText className="mr-1 h-3 w-3" />
                                  Transcribe
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {comment.audio_url && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={async (e) => {
                                e.stopPropagation();
                                
                                // If this comment is already playing, toggle pause/play
                                if (playingCommentId === comment.id && commentAudioRef.current) {
                                  if (commentAudioRef.current.paused) {
                                    commentAudioRef.current.play().catch(() => {});
                                  } else {
                                    commentAudioRef.current.pause();
                                  }
                                  return;
                                }
                                
                                // Stop any current audio
                                stopCommentAudio();
                                if (audioRef.current) {
                                  audioRef.current.pause();
                                }
                                
                                setPlayingCommentId(comment.id);
                                
                                let url = commentSignedUrls[comment.id];
                                if (!url) {
                                  const { data } = await supabase.storage
                                    .from("sermon-comments-audio")
                                    .createSignedUrl(comment.audio_url!, 3600);
                                  if (data?.signedUrl) {
                                    url = data.signedUrl;
                                    setCommentSignedUrls(prev => ({ ...prev, [comment.id]: url }));
                                  }
                                }
                                
                                if (url) {
                                  const audio = new Audio(url);
                                  commentAudioRef.current = audio;
                                  let handled = false;
                                  const cleanup = () => {
                                    if (handled) return;
                                    handled = true;
                                    setPlayingCommentId(null);
                                    commentAudioRef.current = null;
                                  };
                                  audio.onended = cleanup;
                                  audio.onerror = () => {
                                    const mediaError = audio.error;
                                    if (mediaError && mediaError.code !== MediaError.MEDIA_ERR_ABORTED) {
                                      cleanup();
                                    }
                                  };
                                  try {
                                    await audio.play();
                                  } catch (err: any) {
                                    if (err.name !== 'AbortError') {
                                      cleanup();
                                    }
                                  }
                                }
                              }}
                            >
                              {playingCommentId === comment.id ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteComment(comment.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              groupIntoParagraphs(sentences).map((paragraph, idx, allParagraphs) => {
                const firstSentence = paragraph[0];
                const lastSentence = paragraph[paragraph.length - 1];
                // Use next paragraph's first sentence start as the upper boundary to cover inter-sentence gaps
                const nextParagraph = allParagraphs[idx + 1];
                const rangeEnd = nextParagraph ? nextParagraph[0].start_time_ms : lastSentence.end_time_ms + 60000;
                const hasAudioComment = comments.some(
                  c => c.audio_url && c.start_time_ms >= firstSentence.start_time_ms && c.start_time_ms < rangeEnd
                );
                const hasPeak = showVolumeChanges && paragraphHasPeak(paragraph);
                const isFastSpeech = hasFastSpeechRate(paragraph, fastSpeechThreshold);
                
                // Determine active analytics highlights
                const isSlowSpeech = showSlowSpeech && getSlowSpeechParagraphs(slowSpeechThreshold).some(
                  p => p[0].start_time_ms === firstSentence.start_time_ms
                );
                
                // Find which filler word this paragraph contains (for color matching)
                let verbalPauseColor = null;
                if (showVerbalPauses) {
                  const topFillers = getTopFillerWords();
                  for (const filler of topFillers) {
                    if (visibleFillerWords.has(filler.word)) {
                      const hasThisFiller = paragraph.some(s => 
                        s.sentence_text.toLowerCase().includes(filler.word.toLowerCase())
                      );
                      if (hasThisFiller) {
                        verbalPauseColor = filler.color;
                        break;
                      }
                    }
                  }
                }
                const hasVerbalPause = verbalPauseColor !== null;
                
                // Find which insider term this paragraph contains (for color matching)
                let insiderTermColor = null;
                if (showInsiderLanguage) {
                  const topTerms = getTopInsiderTerms();
                  for (const term of topTerms) {
                    if (visibleInsiderTerms.has(term.word)) {
                      const regex = new RegExp(`\\b${term.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                      const hasThisTerm = paragraph.some(s => regex.test(s.sentence_text));
                      if (hasThisTerm) {
                        insiderTermColor = term.color;
                        break;
                      }
                    }
                  }
                }
                const hasInsiderTerm = insiderTermColor !== null;
                
                const hasVolumeChange = showVolumeChanges && getParagraphVolumeLevel(paragraph) !== 0;
                const isActiveFastSpeech = showFastSpeech && isFastSpeech;
                const hasScripture = paragraphContainsScripture(paragraph);
                
                // Check if paragraph contains confusing phrases
                const hasConfusing = showConfusingPhrases && confusingPhrases && confusingPhrases.phrases.some(p => {
                  return paragraph.some(s => s.start_time_ms === p.start_time_ms);
                });
                
                // Determine highlight color and style based on active analytics
                let highlightStyle = "hover:bg-muted";
                let customStyle: React.CSSProperties = {};
                
                if (isCurrentParagraph(paragraph)) {
                  highlightStyle = "bg-primary/10 border border-primary";
                } else if (previewingParagraph === idx) {
                  highlightStyle = "bg-accent/20 border border-accent";
                } else if (isActiveFastSpeech) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#d946ef80',
                    borderColor: '#d946ef'
                  };
                } else if (isSlowSpeech) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#06b6d480',
                    borderColor: '#06b6d4'
                  };
                } else if (hasVolumeChange) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#f59e0b80',
                    borderColor: '#f59e0b'
                  };
                } else if (hasVerbalPause && verbalPauseColor) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: `${verbalPauseColor}80`,
                    borderColor: verbalPauseColor
                  };
                } else if (hasInsiderTerm && insiderTermColor) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: `${insiderTermColor}80`,
                    borderColor: insiderTermColor
                  };
                } else if (hasScripture) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#10b98180',
                    borderColor: '#10b981'
                  };
                } else if (hasConfusing) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#ef444440',
                    borderColor: '#ef4444'
                  };
                } else if (hasPeak) {
                  highlightStyle = "bg-orange-500/20 border border-orange-500/50 hover:bg-orange-500/30";
                } else if (showQuestions && paragraph.some(s => {
                  if (!s.sentence_text.trim().endsWith('?')) return false;
                  if (isSentenceInScripture(s.sentence_text, sentences.indexOf(s))) return false;
                  if (congregationQuestionIndices && !congregationQuestionIndices.has(sentences.indexOf(s))) return false;
                  return true;
                })) {
                  highlightStyle = "border-2 hover:opacity-90 transition-all";
                  customStyle = {
                    backgroundColor: '#f59e0b40',
                    borderColor: '#f59e0b'
                  };
                }
                
                return (
                  <div
                    key={idx}
                    ref={el => { paragraphRefs.current[idx] = el; }}
                    className={`transcript-paragraph p-4 rounded-xl transition-all duration-200 cursor-pointer relative group shadow-sm hover:shadow-md ${highlightStyle}`}
                    style={customStyle}
                    onClick={() => {
                      if (isCurrentParagraph(paragraph)) {
                        if (playing) {
                          audioRef.current?.pause();
                        } else {
                          audioRef.current?.play().catch(() => {});
                        }
                      } else {
                        const firstSentence = paragraph[0];
                        seekTo(firstSentence.start_time_ms);
                        if (!playing) {
                          audioRef.current?.play().catch(() => {});
                        }
                      }
                    }}
                  >
                    {hasAudioComment && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs">
                        <Play className="h-3 w-3 mr-1" />
                        Has Commentary
                      </Badge>
                    )}
                    {!hasAudioComment && isActiveFastSpeech && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-fuchsia-500/50 border-fuchsia-500">
                        ⚡ Fast Speech
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && isSlowSpeech && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-cyan-500/50 border-cyan-500">
                        🐌 Slow Speech
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && hasVolumeChange && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-amber-500/50 border-amber-500">
                        📊 Volume Change
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && hasVerbalPause && verbalPauseColor && (
                      <Badge 
                        variant="outline" 
                        className="absolute top-2 right-2 text-xs"
                        style={{
                          backgroundColor: `${verbalPauseColor}80`,
                          borderColor: verbalPauseColor
                        }}
                      >
                        🔁 Verbal Pause
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && !hasVerbalPause && hasInsiderTerm && insiderTermColor && (
                      <Badge 
                        variant="outline" 
                        className="absolute top-2 right-2 text-xs"
                        style={{
                          backgroundColor: `${insiderTermColor}80`,
                          borderColor: insiderTermColor
                        }}
                      >
                        📖 Insider Language
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && !hasVerbalPause && !hasInsiderTerm && hasConfusing && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-red-500/40 border-red-500">
                        ⚠️ Insider Language
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && !hasVerbalPause && !hasInsiderTerm && !hasConfusing && hasPeak && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-orange-500/20 border-orange-500">
                        🔉 Low Volume
                      </Badge>
                    )}
                    {(() => {
                      const paragraphComments = getCommentsForRange(firstSentence.start_time_ms, rangeEnd)
                        .sort((a, b) => a.start_time_ms - b.start_time_ms);
                      
                      if (paragraphComments.length === 0) {
                        // No comments — render paragraph as before
                        return (
                          <div className="flex items-start gap-3">
                            <Badge className="badge-gradient text-xs font-mono shrink-0">
                              {Math.floor(firstSentence.start_time_ms / 1000 / 60)}:
                              {String(Math.floor((firstSentence.start_time_ms / 1000) % 60)).padStart(2, "0")}
                            </Badge>
                            <p className="flex-1 leading-relaxed font-serif text-foreground/90">{paragraph.map((s) => s.sentence_text).join(" ")}</p>
                          </div>
                        );
                      }
                      
                      // Split paragraph sentences around each comment's insertion point
                      const segments: { type: 'text'; sentences: Sentence[] }[] | { type: 'comment'; comment: Comment }[] = [];
                      const result: Array<{ type: 'text'; sentences: typeof paragraph } | { type: 'comment'; comment: Comment }> = [];
                      let remainingSentences = [...paragraph];
                      
                      for (const comment of paragraphComments) {
                        // Find the split point: sentences before the comment's start_time_ms
                        const beforeIdx = remainingSentences.findIndex(s => s.start_time_ms >= comment.start_time_ms);
                        let before: typeof paragraph;
                        if (beforeIdx === -1) {
                          before = remainingSentences;
                          remainingSentences = [];
                        } else if (beforeIdx === 0) {
                          before = [];
                        } else {
                          before = remainingSentences.slice(0, beforeIdx);
                          remainingSentences = remainingSentences.slice(beforeIdx);
                        }
                        if (before.length > 0) {
                          result.push({ type: 'text', sentences: before });
                        }
                        result.push({ type: 'comment', comment });
                      }
                      if (remainingSentences.length > 0) {
                        result.push({ type: 'text', sentences: remainingSentences });
                      }
                      
                      return (
                        <div className="space-y-2">
                          {result.map((segment, segIdx) => {
                            if (segment.type === 'text') {
                              return (
                                <div key={`text-${segIdx}`} className="flex items-start gap-3">
                                  {segIdx === 0 && (
                                    <Badge className="badge-gradient text-xs font-mono shrink-0">
                                      {Math.floor(firstSentence.start_time_ms / 1000 / 60)}:
                                      {String(Math.floor((firstSentence.start_time_ms / 1000) % 60)).padStart(2, "0")}
                                    </Badge>
                                  )}
                                  {segIdx !== 0 && <div className="w-[52px] shrink-0" />}
                                  <p className="flex-1 leading-relaxed font-serif text-foreground/90">{segment.sentences.map((s) => s.sentence_text).join(" ")}</p>
                                </div>
                              );
                            } else {
                              const comment = segment.comment;
                              return (
                                <div
                                  key={comment.id}
                                  className="p-3 rounded-lg shadow-sm transition-all duration-200 hover:shadow-md ml-[52px]"
                                  style={{
                                    backgroundColor: comment.evaluation_rules?.color
                                      ? `${comment.evaluation_rules.color}15`
                                      : "hsl(var(--card))",
                                    borderLeft: comment.evaluation_rules?.color
                                      ? `4px solid ${comment.evaluation_rules.color}`
                                      : "4px solid hsl(var(--primary))",
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      {comment.evaluation_rules && (
                                        <Badge
                                          variant="outline"
                                          className="mb-1"
                                          style={{ borderColor: comment.evaluation_rules.color }}
                                        >
                                          {comment.evaluation_rules.name}
                                        </Badge>
                                      )}
                                      <p className="text-sm font-bold">{comment.comment_text}</p>
                                      {comment.audio_url && comment.comment_text === "Audio comment" && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="mt-1"
                                          onClick={() => handleTranscribeComment(comment)}
                                          disabled={transcribingCommentId === comment.id}
                                        >
                                          {transcribingCommentId === comment.id ? (
                                            <>
                                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                              Transcribing...
                                            </>
                                          ) : (
                                            <>
                                              <FileText className="mr-1 h-3 w-3" />
                                              Transcribe
                                            </>
                                          )}
                                        </Button>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {comment.audio_url && (
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-8 w-8"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            
                                            if (playingCommentId === comment.id && commentAudioRef.current) {
                                              if (commentAudioRef.current.paused) {
                                                commentAudioRef.current.play().catch(() => {});
                                              } else {
                                                commentAudioRef.current.pause();
                                              }
                                              return;
                                            }
                                            
                                            stopCommentAudio();
                                            if (audioRef.current) {
                                              audioRef.current.pause();
                                            }
                                            
                                            setPlayingCommentId(comment.id);
                                            
                                            let url = commentSignedUrls[comment.id];
                                            if (!url) {
                                              const { data } = await supabase.storage
                                                .from("sermon-comments-audio")
                                                .createSignedUrl(comment.audio_url!, 3600);
                                              if (data?.signedUrl) {
                                                url = data.signedUrl;
                                                setCommentSignedUrls(prev => ({ ...prev, [comment.id]: url }));
                                              }
                                            }
                                            
                                            if (url) {
                                              const audio = new Audio(url);
                                              commentAudioRef.current = audio;
                                              let handled = false;
                                              const cleanup = () => {
                                                if (handled) return;
                                                handled = true;
                                                setPlayingCommentId(null);
                                                commentAudioRef.current = null;
                                              };
                                              audio.onended = cleanup;
                                              audio.onerror = () => {
                                                const mediaError = audio.error;
                                                if (mediaError && mediaError.code !== MediaError.MEDIA_ERR_ABORTED) {
                                                  cleanup();
                                                }
                                              };
                                              try {
                                                await audio.play();
                                              } catch (err: any) {
                                                if (err.name !== 'AbortError') {
                                                  cleanup();
                                                }
                                              }
                                            }
                                          }}
                                        >
                                          {playingCommentId === comment.id ? (
                                            <Pause className="h-4 w-4" />
                                          ) : (
                                            <Play className="h-4 w-4" />
                                          )}
                                        </Button>
                                      )}
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleDeleteComment(comment.id)}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                          })}
                        </div>
                      );
                    })()}
                    {/* Insert comment button between paragraphs */}
                    <div className="flex justify-center -mb-6 mt-2 relative z-10">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full h-8 px-3 bg-background shadow-sm border-dashed opacity-0 hover:opacity-100 group-hover:opacity-60 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCommentDialog(firstSentence.start_time_ms, lastSentence.end_time_ms);
                        }}
                      >
                        <MessageSquare className="h-3 w-3 mr-1" />
                        <span className="text-xs">Add comment</span>
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            {/* Add outro comment button at bottom */}
            <div className="flex justify-center mt-4 pt-4 border-t border-dashed border-border">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full h-8 px-4 bg-background shadow-sm border-dashed"
                onClick={() => {
                  const lastSentence = sentences[sentences.length - 1];
                  openCommentDialog(lastSentence?.end_time_ms || 0, lastSentence?.end_time_ms || 0);
                }}
              >
                <MessageSquare className="h-3 w-3 mr-2" />
                <span className="text-xs">Add outro comment</span>
              </Button>
            </div>
          </div>
          {userScrolledAway && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full shadow-lg gap-2"
                onClick={scrollToActiveParagraph}
              >
                <ArrowLeft className="h-3 w-3 rotate-[-90deg]" />
                Return to current paragraph
              </Button>
            </div>
          )}
        </Card>
        </div>{/* end flex wrapper */}
      </div>

      {commentDialogOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border bg-card p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Recording Comment</h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
              if (!transcribing) {
                setCommentDialogOpen(false);
                setAudioBlob(null);
              }
            }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <AudioRecorder
            autoStart={commentDialogOpen}
            onRecordingComplete={(blob) => {
              setAudioBlob(blob);
              handleAutoSaveAudioComment(blob);
            }}
            onClear={() => setAudioBlob(null)}
            selectedDeviceId={selectedDeviceId}
            onRecordingStateChange={(isRecording, time, stopFn) => {
              setFloatingRecording({ isRecording, time, stopFn });
            }}
          />
          {transcribing && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving and transcribing...
            </div>
          )}
        </div>
      )}

      <Dialog open={evaluationDialogOpen} onOpenChange={setEvaluationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Evaluate Sermon</DialogTitle>
            <DialogDescription>
              Select evaluation rules to apply to this sermon
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evaluation rules found. Create rules first.
              </p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={rule.id}
                    checked={selectedRuleIds.includes(rule.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedRuleIds([...selectedRuleIds, rule.id]);
                      } else {
                        setSelectedRuleIds(selectedRuleIds.filter((id) => id !== rule.id));
                      }
                    }}
                  />
                  <label
                    htmlFor={rule.id}
                    className="flex-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: rule.color }}
                      />
                      {rule.name}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEvaluationDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEvaluate} disabled={evaluating || selectedRuleIds.length === 0}>
              {evaluating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Evaluation
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FloatingRecordingIndicator
        isRecording={floatingRecording.isRecording}
        recordingTime={floatingRecording.time}
        onStopRecording={() => floatingRecording.stopFn?.()}
      />

      {/* Floating Add Comment button when audio is paused */}
      {!playing && !playingCommentId && !floatingRecording.isRecording && audioUrl && currentTime > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Button
            size="lg"
            className="shadow-lg gap-2"
            onClick={() => {
              // Find the sentence/paragraph at current time for context
              const currentSentence = sentences.find(
                s => currentTime >= s.start_time_ms && currentTime <= s.end_time_ms
              );
              const timeMs = currentSentence ? currentSentence.start_time_ms : Math.round(currentTime);
              const endMs = currentSentence ? currentSentence.end_time_ms : Math.round(currentTime) + 1000;
              openCommentDialog(timeMs, endMs);
            }}
          >
            <MessageSquare className="h-5 w-5" />
            Add comment at {Math.floor(currentTime / 1000 / 60)}:{String(Math.floor((currentTime / 1000) % 60)).padStart(2, "0")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default SermonViewer;