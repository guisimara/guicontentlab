// lib/highlight.ts
// Highlight engine. Produces HTML spans for a paragraph's text.
// Miolo: bold(700) + wine (#6F0606). Capa/CTA: weight-only (700 white),
// linking words stay 300 white.

export interface HighlightResult {
  html: string; // safe HTML with <b> / <span> markup applied
  highlightsApplied: { word: string; type: "manual" | "fixed-list" | "auto-selected" | "numbered-line" | "bible-ref" }[];
}

const FIXED_WORDS = [
  "Deus",
  "Jesus",
  "Cristo",
  "F[eé]", // Fé (accent-insensitive input already normalized below)
  "Palavra",
  "Bíblia",
  "Oração",
  "Senhor",
  "Espírito Santo",
  "Evangelho",
];

const LINKING_WORDS = new Set(
  `a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre até após entre contra desde e ou mas que se como quando porque ao aos à às me te lhe nos vos lhes`
    .split(/\s+/)
    .map((w) => w.toLowerCase())
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Fixed word list matching, accent/case-insensitive, whole word, with basic
// inflections for "Fé" (fé, fé's n/a in pt) and "Palavra" (palavra, palavras).
const FIXED_WORD_PATTERNS: RegExp[] = [
  /\bdeus\b/giu,
  /\bjesus\b/giu,
  /\bcristo\b/giu,
  /\bfe\b/giu, // matches "fé"/"fe" after accent-stripping is done separately for matching only
  /\bpalavras?\b/giu,
  /\bbiblia\b/giu,
  /\boracoes?\b|\boracao\b/giu,
  /\bsenhor\b/giu,
  /\bespirito santo\b/giu,
  /\bevangelho\b/giu,
];

interface Token {
  text: string; // original substring (with punctuation as part of raw text run)
  isWord: boolean;
}

function tokenize(text: string): Token[] {
  // Split into words and non-word runs (spaces/punctuation), preserving all characters.
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}'’]+|[^\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const chunk = m[0];
    tokens.push({ text: chunk, isWord: /[\p{L}\p{N}]/u.test(chunk) });
  }
  return tokens;
}

// Applies manual **word** markup: returns html with <b class="wine"> or
// <b class="w700"> wrapping, and strips the ** markers.
function applyManualMarkup(text: string, wineColor: boolean): { html: string; count: number } {
  let count = 0;
  const cls = wineColor ? "wine" : "w700";
  const html = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, (_m, inner) => {
    count++;
    return `<b class="${cls}">${inner}</b>`;
  });
  return { html, count };
}

function findFixedWordSpans(plain: string): { start: number; end: number; word: string }[] {
  const spans: { start: number; end: number; word: string }[] = [];
  const accentless = stripAccents(plain).toLowerCase();
  for (const pattern of FIXED_WORD_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Run pattern against accent-stripped lowercase text but map indices back
    // (1:1 length mapping holds because accent stripping only removes
    // combining marks which are separate codepoints — safe for our NFD case).
    while ((m = pattern.exec(accentless))) {
      spans.push({ start: m.index, end: m.index + m[0].length, word: plain.slice(m.index, m.index + m[0].length) });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // remove overlaps
  const merged: typeof spans = [];
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1].end) continue;
    merged.push(s);
  }
  return merged;
}

const BIBLE_REF_REGEX =
  /\b((?:[1-3]\s)?[A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)\s(\d{1,3}):(\d{1,3})(-(\d{1,3}))?\b/g;

function isNumberedLine(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

/**
 * Highlights a miolo paragraph. Manual markup, if present in the whole card,
 * must be handled by the caller (disables auto rules for the entire card).
 */
export function highlightMioloParagraph(
  text: string,
  opts: { manualOverride: boolean }
): HighlightResult {
  const applied: HighlightResult["highlightsApplied"] = [];

  if (opts.manualOverride) {
    const { html, count } = applyManualMarkup(text, true);
    for (let i = 0; i < count; i++) applied.push({ word: "(manual)", type: "manual" });
    return { html: html.replace(/\n/g, "<br/>"), highlightsApplied: applied };
  }

  // Numbered line -> whole line bold+wine
  const lines = text.split("\n");
  const lineIsNumbered = lines.map(isNumberedLine);

  // Bible reference detection (own-line already expected per spec; we mark whichever text matches)
  const bibleSpans: { start: number; end: number }[] = [];
  BIBLE_REF_REGEX.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = BIBLE_REF_REGEX.exec(text))) {
    bibleSpans.push({ start: bm.index, end: bm.index + bm[0].length });
    applied.push({ word: bm[0], type: "bible-ref" });
  }

  const fixedSpans = findFixedWordSpans(text).filter(
    (fs) => !bibleSpans.some((bs) => fs.start >= bs.start && fs.end <= bs.end)
  );
  for (const fs of fixedSpans) applied.push({ word: fs.word, type: "fixed-list" });

  // Build combined span list: numbered lines contribute full-line spans.
  type Span = { start: number; end: number; kind: "fixed" | "bible" | "numbered" | "auto" };
  const spans: Span[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset;
    const lineEnd = offset + lines[i].length;
    if (lineIsNumbered[i]) {
      spans.push({ start: lineStart, end: lineEnd, kind: "numbered" });
    }
    offset = lineEnd + 1; // +1 for the \n joiner
  }
  for (const fs of fixedSpans) spans.push({ start: fs.start, end: fs.end, kind: "fixed" });
  for (const bs of bibleSpans) spans.push({ start: bs.start, end: bs.end, kind: "bible" });

  // Minimum 2 highlights rule: if fewer than 2 distinct highlight spans, pick
  // extra content words (excluding linking/function words) until >= 2.
  if (spans.length < 2) {
    const tokens = tokenize(text);
    let idx = 0;
    const covered = (s: number, e: number) => spans.some((sp) => s < sp.end && e > sp.start);
    for (const t of tokens) {
      const start = idx;
      const end = idx + t.text.length;
      idx = end;
      if (!t.isWord) continue;
      if (t.text.length < 4) continue; // skip short/function-like words
      if (LINKING_WORDS.has(t.text.toLowerCase())) continue;
      if (covered(start, end)) continue;
      spans.push({ start, end, kind: "auto" });
      applied.push({ word: t.text, type: "auto-selected" });
      if (spans.length >= 2) break;
    }
  }

  spans.sort((a, b) => a.start - b.start);
  // merge overlaps, keep first
  const merged: Span[] = [];
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1].end) continue;
    merged.push(s);
  }

  let html = "";
  let cursor = 0;
  for (const s of merged) {
    html += escapeHtml(text.slice(cursor, s.start));
    html += `<b class="wine">${escapeHtml(text.slice(s.start, s.end))}</b>`;
    cursor = s.end;
  }
  html += escapeHtml(text.slice(cursor));

  return { html: html.replace(/\n/g, "<br/>"), highlightsApplied: applied };
}

/**
 * Highlights a capa/cta paragraph: everything bold(700) white except
 * linking words, which stay 300 white. Manual **markup** overrides this
 * per-piece.
 */
export function highlightCapaCta(text: string, opts: { manualOverride: boolean }): HighlightResult {
  if (opts.manualOverride) {
    const { html, count } = applyManualMarkup(text, false);
    const applied = Array.from({ length: count }, () => ({ word: "(manual)", type: "manual" as const }));
    // Non-manual text in a manual-override piece still defaults to weight 300
    // per spec ("disables the automatic rule for that specific piece").
    return { html: `<span class="w300">${html}</span>`, highlightsApplied: applied };
  }

  const tokens = tokenize(text);
  const applied: HighlightResult["highlightsApplied"] = [];
  let html = "";
  for (const t of tokens) {
    if (!t.isWord) {
      html += escapeHtml(t.text);
      continue;
    }
    const isLinking = LINKING_WORDS.has(t.text.toLowerCase());
    if (isLinking) {
      html += `<span class="w300">${escapeHtml(t.text)}</span>`;
    } else {
      html += `<b class="w700">${escapeHtml(t.text)}</b>`;
      applied.push({ word: t.text, type: "fixed-list" });
    }
  }
  return { html, highlightsApplied: applied };
}
