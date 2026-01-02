import { useEffect, useState, useRef } from "react";
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
} from "lucide-react";
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
  const [showFastSpeech, setShowFastSpeech] = useState(true);
  const [showVerbalPauses, setShowVerbalPauses] = useState(false);
  const [showSlowSpeech, setShowSlowSpeech] = useState(false);
  const [showVolumeChanges, setShowVolumeChanges] = useState(false);
  const [showInsiderLanguage, setShowInsiderLanguage] = useState(false);
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
    references: Array<{ reference: string; context: string }>;
    total_count: number;
  } | null>(null);
  const [loadingScriptures, setLoadingScriptures] = useState(false);
  const [showScriptureRefs, setShowScriptureRefs] = useState(false);
  const [previewWithComments, setPreviewWithComments] = useState(true);
  const [playingCommentId, setPlayingCommentId] = useState<string | null>(null);
  const commentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [commentSignedUrls, setCommentSignedUrls] = useState<Record<string, string>>({});
  const [playedCommentIds, setPlayedCommentIds] = useState<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);
  const [wpmChartClickedTime, setWpmChartClickedTime] = useState<number | null>(null);
  const [volumeChartClickedTime, setVolumeChartClickedTime] = useState<number | null>(null);

  const [transcribing, setTranscribing] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [floatingRecording, setFloatingRecording] = useState<{
    isRecording: boolean;
    time: number;
    stopFn: (() => void) | null;
  }>({ isRecording: false, time: 0, stopFn: null });
  

  useEffect(() => {
    checkAuth();
    if (id) {
      fetchSermon();
      fetchSentences();
      fetchComments();
      fetchRules();
      fetchScriptureReferences();
    }
  }, [id]);

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
      const samples = 500; // Number of bars in waveform - increased for more detail
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

  const countInsiderLanguage = (): number => {
    const insiderTerms = {
      single: ['sanctification', 'justification', 'redemption', 'atonement', 'repentance', 
               'trinity', 'gospel', 'salvation', 'saved', 'resurrection', 'discipleship',
               'covenant', 'righteousness', 'idolatry', 'pharisee', 'sadducee', 'propitiation',
               'disciple', 'apostle', 'shepherding', 'iniquity', 'transgression', 'missional',
               'elders', 'deacons', 'liturgy', 'narthex', 'vestibule', 'sanctuary', 'anointed',
               'revival', 'holiness', 'calvinist', 'arminian', 'eucharist', 'apologetics',
               'legalism', 'benediction'],
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
                'accountability group', 'contemporary christian music', 'ccm']
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
               'legalism', 'benediction'],
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
                'accountability group', 'contemporary christian music', 'ccm']
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
               'legalism', 'benediction'],
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
                'accountability group', 'contemporary christian music', 'ccm']
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
      // +2: 2x or more louder
      // +1: 1.5x to 2x louder  
      // 0: 0.67x to 1.5x (baseline range)
      // -1: 0.5x to 0.67x quieter
      // -2: 0.5x or less quieter
      if (volumeRatio >= 2.0) {
        counts[2]++;
      } else if (volumeRatio >= 1.5) {
        counts[1]++;
      } else if (volumeRatio <= 0.5) {
        counts[-2]++;
      } else if (volumeRatio <= 0.67) {
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
    
    if (volumeRatio >= 2.0) return 2;
    if (volumeRatio >= 1.5) return 1;
    if (volumeRatio <= 0.5) return -2;
    if (volumeRatio <= 0.67) return -1;
    return 0;
  };

  const getVolumeChangeParagraphs = () => {
    if (sentences.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    
    // Only return paragraphs with non-baseline volume (not level 0)
    return paragraphs.filter(p => getParagraphVolumeLevel(p) !== 0);
  };

  const paragraphContainsScripture = (paragraph: Sentence[]): boolean => {
    if (!scriptureRefs || !showScriptureRefs) return false;
    
    const paragraphText = paragraph.map(s => s.sentence_text).join(" ");
    
    // Check if any scripture reference context appears in this paragraph
    return scriptureRefs.references.some(ref => {
      // Extract a meaningful snippet from the context to search for
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
      if (previewWithComments && playing && !playingCommentId) {
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
        await playCommentAudio(comment.audio_url!);
        await new Promise(resolve => setTimeout(resolve, 300)); // Gap after commentary

        // Resume sermon from where we paused (not skipping ahead)
        // This way the comment is "inserted" rather than replacing the sermon audio
        currentTime = commentStart;
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
      // Check if comment overlaps with the range
      return c.start_time_ms >= start && c.start_time_ms <= end;
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
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{sermon.title || "Untitled Sermon"}</h1>
              <Badge variant="outline" className="mt-2">
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

        <Card className="mb-6 p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Button size="icon" onClick={togglePlayPause} disabled={previewingParagraph !== null}>
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
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
                    if (introComment && previewWithComments) {
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
              
              <div className="flex items-center gap-2 border-l pl-4">
                <span className="text-sm text-muted-foreground">Zoom:</span>
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
                {zoomLevel !== 1 && (
                  <Button 
                    size="icon" 
                    variant="outline"
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

              {timeSinceLastCommentInAudio !== null && (
                <div className="flex items-center gap-2 border-l pl-4">
                  <span className="text-sm text-muted-foreground">Since last comment:</span>
                  <span className="text-sm font-medium font-mono">
                    {Math.floor(timeSinceLastCommentInAudio / 60)}:{String(timeSinceLastCommentInAudio % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
              
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
                  className="relative h-12 bg-secondary/30 rounded-lg overflow-x-auto border border-border cursor-pointer"
                  onClick={(e) => {
                    if (!sermon.duration_seconds) return;
                    const container = e.currentTarget;
                    const rect = container.getBoundingClientRect();
                    
                    // Get click position including scroll offset
                    const clickX = e.clientX - rect.left + container.scrollLeft;
                    
                    // Calculate total width of the zoomed timeline
                    const totalWidth = rect.width * zoomLevel;
                    
                    // Calculate percentage of total duration
                    const percentage = clickX / totalWidth;
                    
                    // Convert to time in milliseconds
                    const newTime = percentage * sermon.duration_seconds * 1000;
                    
                    seekTo(newTime);
                  }}
                  onMouseMove={(e) => {
                    if (!sermon.duration_seconds) return;
                    const container = e.currentTarget;
                    const rect = container.getBoundingClientRect();
                    
                    // Get hover position including scroll offset
                    const hoverX = e.clientX - rect.left + container.scrollLeft;
                    
                    // Calculate total width of the zoomed timeline
                    const totalWidth = rect.width * zoomLevel;
                    
                    // Calculate percentage of total duration
                    const percentage = hoverX / totalWidth;
                    
                    // Convert to time in milliseconds
                    const timeMs = percentage * sermon.duration_seconds * 1000;
                    
                    // Store position relative to container for tooltip placement
                    const positionPercent = (hoverX / totalWidth) * 100;
                    
                    setHoverTime(timeMs);
                    setHoverPosition(positionPercent);
                  }}
                  onMouseLeave={() => {
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
                          
                          return (
                            <div
                              key={idx}
                              className="bg-foreground/30 rounded-full absolute"
                              style={{
                                width: '2px',
                                height: `${Math.max(amplitude * 100, 4)}%`,
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
                              className="absolute h-full bg-red-500 border-l-2 border-r-2 border-red-700"
                              style={{
                                left: `${left}%`,
                                width: '2px',
                              }}
                              title={`Commentary at ${Math.floor(segment.start / 1000 / 60)}:${String(Math.floor((segment.start / 1000) % 60)).padStart(2, "0")}`}
                            />
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
                        
                        {/* Scripture reference overlays */}
                        {showScriptureRefs && groupIntoParagraphs(sentences).map((paragraph, idx) => {
                          if (!paragraphContainsScripture(paragraph)) return null;
                          
                          const start = paragraph[0].start_time_ms;
                          const end = paragraph[paragraph.length - 1].end_time_ms;
                          const left = (start / totalDuration) * 100;
                          const width = ((end - start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`scripture-${idx}`}
                              className="absolute h-full bg-emerald-500/50 border-t-2 border-b-2 border-emerald-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Scripture reference at ${Math.floor(start / 1000 / 60)}:${String(Math.floor((start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                      </>
                    );
                  })()}
                  
                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                    style={{
                      left: sermon.duration_seconds
                        ? `${(currentTime / (sermon.duration_seconds * 1000)) * 100}%`
                        : "0%",
                    }}
                  >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full" />
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
        <Card className="mb-6 p-6">
          <h2 className="text-xl font-semibold mb-4">Sermon Analytics</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-primary/5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-primary">Words Per Minute</h3>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl font-bold text-primary">
                  {Math.round(getAverageSpeechRate())}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Average WPM
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-center border-t pt-3">
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

            <Card className="p-4 bg-rose-500/5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-rose-700">Speed Transitions</h3>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl font-bold text-rose-600">
                  {countSpeedTransitions(20)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Pace Changes (20+ WPM)
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-center border-t pt-3">
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
              className="p-4 bg-fuchsia-500/5 cursor-pointer hover:bg-fuchsia-500/10 transition-colors"
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
                  {countFastSpeechParagraphs(fastSpeechThreshold)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Fast Speech Sections ({fastSpeechThreshold.toFixed(2)}x+)
                </div>
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
              className="p-4 bg-cyan-500/5 cursor-pointer hover:bg-cyan-500/10 transition-colors"
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
                  {countSlowSpeechParagraphs(slowSpeechThreshold)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Slow Speech Sections ({slowSpeechThreshold.toFixed(2)}x)
                </div>
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
              className="p-4 bg-indigo-500/5"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-bold text-indigo-700">Insider Language</h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2">
                      View All
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto bg-background border shadow-lg z-50">
                    {getAllInsiderTerms().length === 0 ? (
                      <DropdownMenuItem disabled className="text-muted-foreground">
                        No insider terms found
                      </DropdownMenuItem>
                    ) : (
                      getAllInsiderTerms().map((term) => (
                        <DropdownMenuItem 
                          key={term.word}
                          className="flex justify-between cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleInsiderTerm(term.word);
                          }}
                        >
                          <span className="capitalize truncate mr-2">{term.word}</span>
                          <span className="font-semibold text-indigo-600">{term.count}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col items-center text-center mb-4">
                <div className="text-3xl font-bold text-indigo-600">
                  {countInsiderLanguage()}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Instances
                </div>
              </div>
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs text-muted-foreground mb-2">
                  <p className="font-medium">Top 3 Church Terms:</p>
                  <p className="mt-1 text-xs opacity-80">May be unclear to unchurched guests</p>
                </div>
                {getTopInsiderTerms().map((term) => (
                  <div key={term.word} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={visibleInsiderTerms.has(term.word)}
                        onCheckedChange={() => toggleInsiderTerm(term.word)}
                      />
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: term.color }}
                      />
                      <span className="text-sm capitalize">{term.word}</span>
                    </div>
                    <span className="text-sm font-medium">{term.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card 
              className="p-4 bg-amber-500/5 cursor-pointer hover:bg-amber-500/10 transition-colors"
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
              className="p-4 bg-orange-500/5"
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
                  {countVerbalPauses()}
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
              className="p-4 bg-emerald-500/5 cursor-pointer hover:bg-emerald-500/10 transition-colors"
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
                    scriptureRefs?.total_count || 0
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Biblical Citations
                </div>
              </div>
              {scriptureRefs && scriptureRefs.references.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="text-xs text-muted-foreground mb-2">
                    <p className="font-medium">Scripture References:</p>
                  </div>
                  {scriptureRefs.references.map((ref, idx) => (
                    <div key={idx} className="text-sm border-l-2 border-emerald-500 pl-2 py-1">
                      <div className="font-medium text-emerald-700">{ref.reference}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {ref.context.substring(0, 100)}...
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

            <Card className="p-4 bg-violet-500/5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-bold text-violet-700">My Comments</h3>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl font-bold text-violet-600">
                  {comments.length}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Comments Added
                </div>
              </div>
              {comments.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground text-center">
                  {comments.filter(c => c.audio_url).length} with audio
                </div>
              )}
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
                        setWpmChartClickedTime(timeMs);
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
              {wpmChartClickedTime !== null && (
                <div className="text-center mt-2 text-sm font-medium text-primary">
                  ▶ {Math.floor(wpmChartClickedTime / 60000)}:{String(Math.floor((wpmChartClickedTime % 60000) / 1000)).padStart(2, '0')}
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
                        setVolumeChartClickedTime(timeMs);
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
              {volumeChartClickedTime !== null && (
                <div className="text-center mt-2 text-sm font-medium text-primary">
                  ▶ {Math.floor(volumeChartClickedTime / 60000)}:{String(Math.floor((volumeChartClickedTime % 60000) / 1000)).padStart(2, '0')}
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

        <Card className="p-6">
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
                  <p className="flex-1 text-sm">{comment.comment_text}</p>
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
          <div className="space-y-4">
            {viewMode === "sentence" ? (
              sentences.map((sentence) => (
                <div
                  key={sentence.id}
                  className={`p-3 rounded-lg transition-colors cursor-pointer ${
                    isCurrentSentence(sentence)
                      ? "bg-primary/10 border border-primary"
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
                          <p className="text-sm">{comment.comment_text}</p>
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
              groupIntoParagraphs(sentences).map((paragraph, idx) => {
                const firstSentence = paragraph[0];
                const lastSentence = paragraph[paragraph.length - 1];
                const hasAudioComment = comments.some(
                  c => c.audio_url && c.start_time_ms >= firstSentence.start_time_ms && c.end_time_ms <= lastSentence.end_time_ms
                );
                const hasPeak = paragraphHasPeak(paragraph);
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
                } else if (hasPeak) {
                  highlightStyle = "bg-orange-500/20 border border-orange-500/50 hover:bg-orange-500/30";
                }
                
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg transition-colors cursor-pointer relative group ${highlightStyle}`}
                    style={customStyle}
                    onClick={() => handlePreviewParagraph(idx)}
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
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && !hasVerbalPause && !hasInsiderTerm && hasPeak && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-orange-500/20 border-orange-500">
                        🔉 Low Volume
                      </Badge>
                    )}
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="text-xs">
                        {Math.floor(firstSentence.start_time_ms / 1000 / 60)}:
                        {String(Math.floor((firstSentence.start_time_ms / 1000) % 60)).padStart(2, "0")}
                      </Badge>
                      <p className="flex-1">{paragraph.map((s) => s.sentence_text).join(" ")}</p>
                    </div>
                    {getCommentsForRange(firstSentence.start_time_ms, lastSentence.end_time_ms).length > 0 && (
                      <div className="mt-2 space-y-2">
                        {getCommentsForRange(firstSentence.start_time_ms, lastSentence.end_time_ms).map((comment) => (
                          <div
                            key={comment.id}
                            className="p-2 rounded"
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
                                <p className="text-sm">{comment.comment_text}</p>
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
                    )}
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
          </div>
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
        </Card>
      </div>

      <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Comment</DialogTitle>
            <DialogDescription>
              Add a text or audio comment for this section
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={commentType} onValueChange={(v) => setCommentType(v as "text" | "audio")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
            </TabsList>
            
            <TabsContent value="text" className="space-y-4">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Type your comment here..."
                className="min-h-[100px]"
              />
            </TabsContent>
            
            <TabsContent value="audio" className="space-y-4">
              <AudioRecorder
                onRecordingComplete={(blob) => {
                  setAudioBlob(blob);
                  // Auto-save audio comment immediately after recording
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
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setCommentDialogOpen(false);
              setNewComment("");
              setAudioBlob(null);
            }} disabled={transcribing}>
              Cancel
            </Button>
            <Button onClick={handleAddComment} disabled={(!newComment.trim() && !audioBlob) || transcribing}>
              {transcribing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Transcribing...
                </>
              ) : (
                "Add Comment"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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