import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/preacherslens-logo.png";

export interface ClientReportData {
  sermonTitle: string;
  sermonDate: string;
  durationSeconds: number | null;
  communicatorName?: string | null;

  engagement: {
    total: number;
    subscores: { label: string; score: number }[];
  };

  metrics: {
    averageWPM: number;
    wordCount: number;
    verbalPausesCount: number;
    insiderLanguageCount: number;
    congregationQuestions: number;
    illustrationScore: number;
  };

  topFillerWords: { word: string; count: number }[];
  topInsiderTerms: { word: string; count: number }[];
  repeatedPhrases: { word: string; count: number }[];

  scriptureRefs: { reference: string; context: string }[];

  aiComments: {
    ruleName: string;
    ruleColor?: string | null;
    items: { startMs: number; text: string }[];
  }[];
}

type RGB = readonly [number, number, number];

const BRAND = {
  ink: [22, 28, 45] as RGB,
  primary: [30, 58, 95] as RGB,
  primaryDark: [16, 35, 64] as RGB,
  accent: [236, 72, 153] as RGB,
  amber: [217, 119, 6] as RGB,
  teal: [13, 148, 136] as RGB,
  rose: [225, 29, 72] as RGB,
  sky: [37, 99, 158] as RGB,
  muted: [100, 116, 139] as RGB,
  surface: [248, 250, 252] as RGB,
  surfaceAlt: [241, 245, 249] as RGB,
  divider: [226, 232, 240] as RGB,
  white: [255, 255, 255] as RGB,
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

const fmtTimestamp = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const fmtDuration = (sec: number | null): string => {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const setFill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const setStroke = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const setText = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

const drawFooter = (doc: jsPDF, pageNum: number, totalPages: number, sermonTitle: string) => {
  setStroke(doc, BRAND.divider);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, PAGE_H - 36, PAGE_W - MARGIN, PAGE_H - 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(doc, BRAND.muted);
  doc.text("THE PREACHER\u2019S LENS", MARGIN, PAGE_H - 22);
  const truncated = sermonTitle.length > 60 ? sermonTitle.slice(0, 57) + "…" : sermonTitle;
  doc.text(truncated, PAGE_W / 2, PAGE_H - 22, { align: "center" });
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 22, { align: "right" });
};

const drawScoreBar = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  score: number,
  color: RGB,
) => {
  const clamped = Math.max(0, Math.min(10, score));
  setFill(doc, BRAND.surfaceAlt);
  doc.roundedRect(x, y, w, 8, 4, 4, "F");
  if (clamped > 0) {
    setFill(doc, color);
    doc.roundedRect(x, y, (w * clamped) / 10, 8, 4, 4, "F");
  }
};

const drawMetricCard = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  sub: string,
  accent: RGB,
) => {
  setFill(doc, BRAND.white);
  setStroke(doc, BRAND.divider);
  doc.setLineWidth(0.75);
  doc.roundedRect(x, y, w, h, 6, 6, "FD");
  setFill(doc, accent);
  doc.roundedRect(x, y, 4, h, 2, 2, "F");

  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(label.toUpperCase(), x + 12, y + 16);

  setText(doc, BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(value, x + 12, y + 42);

  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(sub, x + 12, y + h - 10);
};

const drawCoverPage = (doc: jsPDF, data: ClientReportData, logoDataUrl: string | null) => {
  const bandH = 240;
  for (let i = 0; i < bandH; i++) {
    const t = i / bandH;
    const r = Math.round(BRAND.primaryDark[0] + (BRAND.primary[0] - BRAND.primaryDark[0]) * t);
    const g = Math.round(BRAND.primaryDark[1] + (BRAND.primary[1] - BRAND.primaryDark[1]) * t);
    const b = Math.round(BRAND.primaryDark[2] + (BRAND.primary[2] - BRAND.primaryDark[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(0, i, PAGE_W, 1, "F");
  }

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", PAGE_W - MARGIN - 72, 44, 72, 72);
    } catch {
      // ignore image errors
    }
  }

  setText(doc, BRAND.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("THE PREACHER\u2019S LENS", MARGIN, 70);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Sermon Performance Report", MARGIN, 86);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(data.sermonTitle || "Untitled Sermon", PAGE_W - MARGIN * 2);
  doc.text(titleLines.slice(0, 3), MARGIN, 150);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const metaParts: string[] = [];
  if (data.communicatorName) metaParts.push(data.communicatorName);
  metaParts.push(data.sermonDate);
  if (data.durationSeconds) metaParts.push(`${fmtDuration(data.durationSeconds)} runtime`);
  doc.text(metaParts.join("  •  "), MARGIN, 220);

  const cardX = MARGIN;
  const cardY = 280;
  const cardW = PAGE_W - MARGIN * 2;
  const cardH = 200;
  setFill(doc, BRAND.white);
  setStroke(doc, BRAND.divider);
  doc.setLineWidth(1);
  doc.roundedRect(cardX, cardY, cardW, cardH, 10, 10, "FD");

  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("OVERALL ENGAGEMENT SCORE", cardX + 24, cardY + 28);

  setText(doc, BRAND.primaryDark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(72);
  const scoreText = `${data.engagement.total.toFixed(1)}`;
  doc.text(scoreText, cardX + 24, cardY + 100);
  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(18);
  const scoreWidth = doc.getTextWidth(scoreText);
  doc.text("/ 10", cardX + 24 + scoreWidth + 8, cardY + 100);

  const barsX = cardX + 260;
  const barsW = cardW - 260 - 24;
  let by = cardY + 36;
  data.engagement.subscores.forEach((sub) => {
    setText(doc, BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(sub.label, barsX, by);
    setText(doc, BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.text(`${sub.score.toFixed(1)}`, barsX + barsW, by, { align: "right" });
    drawScoreBar(doc, barsX, by + 6, barsW, sub.score, BRAND.primary);
    by += 36;
  });

  const stripY = cardY + cardH + 28;
  setFill(doc, BRAND.surface);
  doc.roundedRect(MARGIN, stripY, PAGE_W - MARGIN * 2, 80, 8, 8, "F");
  setText(doc, BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("How to read this report", MARGIN + 16, stripY + 22);
  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const intro =
    "This dashboard summarizes sermon delivery, content, and AI-detected coaching opportunities. Scores reflect dynamics rather than judgment of message — use them as conversation starters.";
  const lines = doc.splitTextToSize(intro, PAGE_W - MARGIN * 2 - 32);
  doc.text(lines, MARGIN + 16, stripY + 40);
};

const ensureSpace = (doc: jsPDF, y: number, needed: number): number => {
  if (y + needed > PAGE_H - 56) {
    doc.addPage();
    return MARGIN + 24;
  }
  return y;
};

const drawSectionHeading = (doc: jsPDF, y: number, label: string, accent: RGB): number => {
  setFill(doc, accent);
  doc.roundedRect(MARGIN, y, 4, 18, 2, 2, "F");
  setText(doc, BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(label, MARGIN + 14, y + 14);
  return y + 30;
};

const drawMetricsPage = (doc: jsPDF, data: ClientReportData) => {
  doc.addPage();
  let y = MARGIN + 12;
  y = drawSectionHeading(doc, y, "Delivery Metrics", BRAND.primary);

  const m = data.metrics;
  const cardW = (PAGE_W - MARGIN * 2 - 16) / 3;
  const cardH = 78;

  const cards: Array<[string, string, string, RGB]> = [
    ["Average Pace", `${m.averageWPM}`, "words per minute", BRAND.primary],
    ["Total Words", `${m.wordCount.toLocaleString()}`, "spoken in sermon", BRAND.sky],
    ["Runtime", fmtDuration(data.durationSeconds), "audio duration", BRAND.teal],
    ["Verbal Pauses", `${m.verbalPausesCount}`, "filler/hesitation moments", BRAND.amber],
    ["Insider Language", `${m.insiderLanguageCount}`, "potentially unclear terms", BRAND.accent],
    ["Audience Questions", `${m.congregationQuestions}`, "rhetorical or direct asks", BRAND.teal],
    ["Illustrations", `${m.illustrationScore.toFixed(1)} / 10`, "story & imagery score", BRAND.primaryDark],
  ];

  for (let i = 0; i < cards.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = MARGIN + col * (cardW + 8);
    const cy = y + row * (cardH + 8);
    const [label, val, sub, color] = cards[i];
    drawMetricCard(doc, x, cy, cardW, cardH, label, val, sub, color);
  }
  y += Math.ceil(cards.length / 3) * (cardH + 8) + 16;

  y = ensureSpace(doc, y, 200);
  y = drawSectionHeading(doc, y, "Language Patterns", BRAND.accent);

  const colW = (PAGE_W - MARGIN * 2 - 16) / 3;
  const drawList = (
    x: number,
    title: string,
    items: { word: string; count: number }[],
    color: RGB,
  ) => {
    setText(doc, BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, x, y);
    setText(doc, BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (items.length === 0) {
      doc.text("None detected", x, y + 16);
      return;
    }
    const top = items.slice(0, 6);
    const max = Math.max(...top.map((t) => t.count));
    let ly = y + 14;
    top.forEach((item) => {
      setText(doc, BRAND.ink);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const wordTxt = item.word.length > 22 ? item.word.slice(0, 21) + "…" : item.word;
      doc.text(wordTxt, x, ly);
      setText(doc, BRAND.muted);
      doc.text(String(item.count), x + colW - 12, ly, { align: "right" });
      setFill(doc, BRAND.surfaceAlt);
      doc.roundedRect(x, ly + 3, colW - 16, 3, 1.5, 1.5, "F");
      setFill(doc, color);
      const w = max > 0 ? ((colW - 16) * item.count) / max : 0;
      doc.roundedRect(x, ly + 3, w, 3, 1.5, 1.5, "F");
      ly += 18;
    });
  };

  drawList(MARGIN, "Top Filler Words", data.topFillerWords, BRAND.amber);
  drawList(MARGIN + colW + 8, "Top Insider Terms", data.topInsiderTerms, BRAND.accent);
  drawList(MARGIN + (colW + 8) * 2, "Most Repeated Phrases", data.repeatedPhrases, BRAND.teal);
};

const drawScripturePage = (doc: jsPDF, data: ClientReportData) => {
  doc.addPage();
  let y = MARGIN + 12;
  y = drawSectionHeading(doc, y, "Scripture References", BRAND.primaryDark);

  if (data.scriptureRefs.length === 0) {
    setText(doc, BRAND.muted);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No scripture references identified in this sermon.", MARGIN, y + 4);
    return;
  }

  setText(doc, BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${data.scriptureRefs.length} reference${data.scriptureRefs.length === 1 ? "" : "s"} found`,
    MARGIN,
    y,
  );
  y += 16;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", "Reference", "Context"]],
    body: data.scriptureRefs.map((r, i) => [String(i + 1), r.reference, r.context]),
    headStyles: {
      fillColor: [BRAND.primaryDark[0], BRAND.primaryDark[1], BRAND.primaryDark[2]],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, textColor: [BRAND.ink[0], BRAND.ink[1], BRAND.ink[2]] },
    alternateRowStyles: { fillColor: [BRAND.surface[0], BRAND.surface[1], BRAND.surface[2]] },
    columnStyles: {
      0: { cellWidth: 26, halign: "center", textColor: [BRAND.muted[0], BRAND.muted[1], BRAND.muted[2]] },
      1: { cellWidth: 110, fontStyle: "bold" },
      2: { cellWidth: "auto" as any },
    },
    styles: {
      cellPadding: 6,
      lineColor: [BRAND.divider[0], BRAND.divider[1], BRAND.divider[2]],
      lineWidth: 0.25,
    },
  });
};

const hexToRgb = (hex?: string | null): RGB => {
  if (!hex) return BRAND.primary;
  const h = hex.replace("#", "");
  if (h.length !== 6) return BRAND.primary;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return BRAND.primary;
  return [r, g, b] as const;
};

const drawCommentsPages = (doc: jsPDF, data: ClientReportData) => {
  doc.addPage();
  let y = MARGIN + 12;
  y = drawSectionHeading(doc, y, "AI Coaching Findings", BRAND.accent);

  if (data.aiComments.length === 0) {
    setText(doc, BRAND.muted);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No AI-generated evaluation findings to report.", MARGIN, y + 4);
    return;
  }

  for (const group of data.aiComments) {
    const accent = hexToRgb(group.ruleColor);

    y = ensureSpace(doc, y, 60);
    setFill(doc, accent);
    doc.roundedRect(MARGIN, y, 8, 8, 2, 2, "F");
    setText(doc, BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(group.ruleName, MARGIN + 16, y + 8);
    setText(doc, BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `${group.items.length} finding${group.items.length === 1 ? "" : "s"}`,
      PAGE_W - MARGIN,
      y + 8,
      { align: "right" },
    );
    y += 18;
    setStroke(doc, BRAND.divider);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 10;

    for (const item of group.items) {
      const ts = fmtTimestamp(item.startMs);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const textLines = doc.splitTextToSize(item.text, PAGE_W - MARGIN * 2 - 60);
      const blockH = Math.max(20, 6 + textLines.length * 12);
      y = ensureSpace(doc, y, blockH + 8);

      setFill(doc, BRAND.surfaceAlt);
      doc.roundedRect(MARGIN, y, 50, 16, 4, 4, "F");
      setText(doc, BRAND.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(ts, MARGIN + 25, y + 11, { align: "center" });

      setText(doc, BRAND.ink);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(textLines, MARGIN + 60, y + 11);

      y += blockH + 6;
    }
    y += 12;
  }
};

const loadLogoDataUrl = async (): Promise<string | null> => {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

export const generateClientReportPdf = async (data: ClientReportData): Promise<Blob> => {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const logoDataUrl = await loadLogoDataUrl();

  drawCoverPage(doc, data, logoDataUrl);
  // Draw logo + brand mark in footer too
  // (footer drawn after all pages added below)
  drawMetricsPage(doc, data);
  drawScripturePage(doc, data);
  drawCommentsPages(doc, data);

  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, p, total, data.sermonTitle || "Sermon Report");
  }

  return doc.output("blob");
};
