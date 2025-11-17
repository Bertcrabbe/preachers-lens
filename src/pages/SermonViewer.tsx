import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
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
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { combineAudioFiles } from "@/utils/audioCombiner";
import { Progress } from "@/components/ui/progress";
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"sentence" | "paragraph">("sentence");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number; end: number } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [evaluationDialogOpen, setEvaluationDialogOpen] = useState(false);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [commentType, setCommentType] = useState<"text" | "audio">("text");
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
  const [viewStart, setViewStart] = useState(0); // percentage of audio (0-100)

  useEffect(() => {
    checkAuth();
    if (id) {
      fetchSermon();
      fetchSentences();
      fetchComments();
      fetchRules();
    }
  }, [id]);

  useEffect(() => {
    if (audioUrl) {
      generateWaveform(audioUrl);
    }
  }, [audioUrl]);

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
    
    const colors = ['#8b5cf6', '#a78bfa', '#c4b5fd']; // purple variations
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

  const getVolumeChangeParagraphs = (threshold: number = 1.5) => {
    if (sentences.length === 0) return [];
    
    const paragraphs = groupIntoParagraphs(sentences);
    
    return paragraphs.filter(p => hasSignificantVolumeChange(p, threshold) !== null);
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
        .single();

      if (error) throw error;
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
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setPlaying(!playing);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime * 1000);
    }
  };

  const openCommentDialog = (start: number, end: number) => {
    setSelectedTimeRange({ start, end });
    setCommentDialogOpen(true);
  };

  const handleAddComment = async () => {
    if ((!newComment.trim() && !audioBlob) || !selectedTimeRange) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let audioUrl = null;

      // Upload audio if present
      if (audioBlob) {
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
          comment_text: newComment || "Audio comment",
          audio_url: audioUrl,
        }]);

      if (error) throw error;

      toast({ title: "Comment added successfully" });
      setCommentDialogOpen(false);
      setNewComment("");
      setAudioBlob(null);
      fetchComments();
    } catch (error: any) {
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
      link.download = `${sermon.title || 'sermon'}_combined.wav`;
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

  const getCommentsForRange = (start: number, end: number) => {
    return comments.filter(
      (c) => c.start_time_ms === start && c.end_time_ms === end
    );
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExport("txt")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export as TXT
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("md")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("docx")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export as DOCX
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              
              <div className="flex items-center gap-2 border-l pl-4">
                <span className="text-sm text-muted-foreground">Zoom:</span>
                <Button 
                  size="icon" 
                  variant="outline"
                  onClick={() => setZoomLevel(Math.max(1, zoomLevel - 1))}
                  disabled={zoomLevel <= 1}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium min-w-[3rem] text-center">{zoomLevel}x</span>
                <Button 
                  size="icon" 
                  variant="outline"
                  onClick={() => setZoomLevel(Math.min(10, zoomLevel + 1))}
                  disabled={zoomLevel >= 10}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                {zoomLevel > 1 && (
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
            </div>
            
            <div className="flex-1 space-y-2">
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
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
                >
                  <div style={{ width: `${zoomLevel * 100}%`, position: 'relative', height: '100%' }}>
                    {/* Waveform visualization */}
                    {waveformData.length > 0 && (
                      <div className="absolute inset-0 flex items-center justify-around">
                        {waveformData.map((amplitude, idx) => {
                          // Only render waveform bars in the visible window
                          const barPosition = (idx / waveformData.length) * 100;
                          const viewWindowSize = 100 / zoomLevel;
                          const viewEnd = viewStart + viewWindowSize;
                          
                          if (zoomLevel > 1 && (barPosition < viewStart || barPosition > viewEnd)) {
                            return null;
                          }
                          
                          return (
                            <div
                              key={idx}
                              className="bg-foreground/30 rounded-full"
                              style={{
                                width: '2px',
                                height: `${Math.max(amplitude * 100, 4)}%`,
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
                      .filter(c => c.audio_url)
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
                              className="absolute h-full bg-blue-500/50 border-t-2 border-b-2 border-blue-600"
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                              }}
                              title={`Slow speech at ${Math.floor(start / 1000 / 60)}:${String(Math.floor((start / 1000) % 60)).padStart(2, "0")}`}
                            />
                          );
                        })}
                        
                        {/* Volume change overlays */}
                        {showVolumeChanges && getVolumeChangeParagraphs(volumeChangeThreshold).map((paragraph, idx) => {
                          const start = paragraph[0].start_time_ms;
                          const end = paragraph[paragraph.length - 1].end_time_ms;
                          const left = (start / totalDuration) * 100;
                          const width = ((end - start) / totalDuration) * 100;
                          
                          return (
                            <div
                              key={`volume-${idx}`}
                              className="absolute h-full bg-emerald-500/50 border-t-2 border-b-2 border-emerald-600"
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
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {Math.floor(currentTime / 1000 / 60)}:
                  {String(Math.floor((currentTime / 1000) % 60)).padStart(2, "0")}
                </span>
                <span>
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
                <div className="w-4 h-2 bg-blue-500/50 border-t border-b border-blue-600 rounded" />
                <span>Slow Speech</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-2 bg-emerald-500/50 border-t border-b border-emerald-600 rounded" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-4 bg-primary/5">
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl font-bold text-primary">
                  {Math.round(getAverageSpeechRate())}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Average Words Per Minute
                </div>
              </div>
            </Card>

            <Card 
              className="p-4 bg-fuchsia-500/5 cursor-pointer hover:bg-fuchsia-500/10 transition-colors"
              onClick={() => setShowFastSpeech(!showFastSpeech)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-fuchsia-700">Fast Speech</h3>
                <Checkbox
                  checked={showFastSpeech}
                  onCheckedChange={(checked) => setShowFastSpeech(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
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
              className="p-4 bg-orange-500/5"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-medium text-orange-700">Communication Opportunity</h3>
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
              className="p-4 bg-blue-500/5 cursor-pointer hover:bg-blue-500/10 transition-colors"
              onClick={() => setShowSlowSpeech(!showSlowSpeech)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-blue-700">Slow Speech</h3>
                <Checkbox
                  checked={showSlowSpeech}
                  onCheckedChange={(checked) => setShowSlowSpeech(checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-col items-center text-center mb-3">
                <div className="text-3xl font-bold text-blue-600">
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
              className="p-4 bg-emerald-500/5 cursor-pointer hover:bg-emerald-500/10 transition-colors"
              onClick={() => setShowVolumeChanges(!showVolumeChanges)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-emerald-700">Volume Changes</h3>
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
                      <div className="text-lg font-bold text-emerald-600">
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
              className="p-4 bg-purple-500/5"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-medium text-purple-700">Insider Language</h3>
              </div>
              <div className="flex flex-col items-center text-center mb-4">
                <div className="text-3xl font-bold text-purple-600">
                  {countInsiderLanguage()}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Churchy Terms Used
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
          </div>
        </Card>

        <Card className="p-6">
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
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
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
                const isFastSpeech = hasFastSpeechRate(paragraph);
                
                // Determine active analytics highlights
                const isSlowSpeech = showSlowSpeech && getSlowSpeechParagraphs(slowSpeechThreshold).some(
                  p => p[0].start_time_ms === firstSentence.start_time_ms
                );
                const hasVerbalPause = showVerbalPauses && Array.from(visibleFillerWords).some(word =>
                  paragraph.some(s => s.sentence_text.toLowerCase().includes(word.toLowerCase()))
                );
                const hasInsiderTerm = showInsiderLanguage && Array.from(visibleInsiderTerms).some(term => {
                  const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                  return paragraph.some(s => regex.test(s.sentence_text));
                });
                const hasVolumeChange = showVolumeChanges && hasSignificantVolumeChange(paragraph, volumeChangeThreshold);
                const isActiveFastSpeech = showFastSpeech && isFastSpeech;
                
                // Determine highlight color and style based on active analytics
                let highlightStyle = "hover:bg-muted";
                let highlightClass = "";
                
                if (isCurrentParagraph(paragraph)) {
                  highlightClass = "bg-primary/10 border border-primary";
                } else if (previewingParagraph === idx) {
                  highlightClass = "bg-accent/20 border border-accent";
                } else if (isActiveFastSpeech) {
                  highlightClass = "bg-fuchsia-500/20 border-2 border-fuchsia-500 hover:bg-fuchsia-500/30";
                } else if (isSlowSpeech) {
                  highlightClass = "bg-blue-500/20 border-2 border-blue-500 hover:bg-blue-500/30";
                } else if (hasVolumeChange) {
                  highlightClass = "bg-emerald-500/20 border-2 border-emerald-500 hover:bg-emerald-500/30";
                } else if (hasVerbalPause) {
                  highlightClass = "bg-orange-500/20 border-2 border-orange-500 hover:bg-orange-500/30";
                } else if (hasInsiderTerm) {
                  highlightClass = "bg-purple-500/20 border-2 border-purple-500 hover:bg-purple-500/30";
                } else if (hasPeak) {
                  highlightClass = "bg-orange-500/20 border border-orange-500/50 hover:bg-orange-500/30";
                } else {
                  highlightClass = highlightStyle;
                }
                
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg transition-colors cursor-pointer relative ${highlightClass}`}
                    onClick={() => handlePreviewParagraph(idx)}
                  >
                    {hasAudioComment && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs">
                        <Play className="h-3 w-3 mr-1" />
                        Has Commentary
                      </Badge>
                    )}
                    {!hasAudioComment && isActiveFastSpeech && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-fuchsia-500/20 border-fuchsia-500">
                        ⚡ Fast Speech
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && isSlowSpeech && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-blue-500/20 border-blue-500">
                        🐌 Slow Speech
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && hasVolumeChange && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-emerald-500/20 border-emerald-500">
                        📊 Volume Change
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && hasVerbalPause && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-orange-500/20 border-orange-500">
                        🔁 Verbal Pause
                      </Badge>
                    )}
                    {!hasAudioComment && !isActiveFastSpeech && !isSlowSpeech && !hasVolumeChange && !hasVerbalPause && hasInsiderTerm && (
                      <Badge variant="outline" className="absolute top-2 right-2 text-xs bg-purple-500/20 border-purple-500">
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
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCommentDialog(firstSentence.start_time_ms, lastSentence.end_time_ms);
                        }}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                    {getCommentsForRange(firstSentence.start_time_ms, lastSentence.end_time_ms).map((comment) => (
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
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteComment(comment.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
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
                onRecordingComplete={(blob) => setAudioBlob(blob)}
                onClear={() => setAudioBlob(null)}
              />
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setCommentDialogOpen(false);
              setNewComment("");
              setAudioBlob(null);
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddComment} disabled={!newComment.trim() && !audioBlob}>
              Add Comment
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
    </div>
  );
};

export default SermonViewer;