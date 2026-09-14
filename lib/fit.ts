// lib/fit.ts
// Auto-fit body font size + card splitting logic for miolo cards.
import type { Page } from "puppeteer";
import { renderMioloTemplate } from "./template";

export const FONT_MAX = 49;
export const FONT_MIN = 42;
export const FONT_STEP = 0.5;
export const AREA_W = 810;
export const AREA_H = 1020;
export const MAX_SPLIT_DEPTH = 3;

export interface ParagraphUnit {
  html: string; // highlighted HTML for this paragraph (atomic — never split internally)
  isAtomic: boolean; // numbered list / bible quote block — never cut adjacent boundary through it
  sourceIndex?: number; // index of the originating paragraph within its miolo card
}

export interface FitResult {
  ok: boolean;
  fontSizePx: number;
  html: string; // final rendered HTML (post widow-fix)
  lineCount: number;
  widowCorrections: number;
  error?: string;
  sourceIndices: number[]; // originating paragraph indices composing this final card
}

async function measure(
  page: Page,
  paragraphs: ParagraphUnit[],
  fontSizePx: number
): Promise<{ height: number; lineCount: number; html: string }> {
  const bodyHtml = paragraphs.map((p) => `<p>${p.html}</p>`).join("");
  const html = renderMioloTemplate({ bodyHtml, fontSizePx });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await (page as any).evaluate(async () => {
    await Promise.all([
      (document as any).fonts.load("300 49px Poppins"),
      (document as any).fonts.load("700 49px Poppins"),
    ]);
    await (document as any).fonts.ready;
  });
  const metrics = await page.evaluate(() => {
    const el = document.getElementById("text-block")!;
    const rect = el.getBoundingClientRect();
    // approximate line count via scrollHeight / computed line-height
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 1;
    const lines = Math.round(el.scrollHeight / lineHeight);
    return { height: el.scrollHeight, rectHeight: rect.height, lines };
  });
  return { height: metrics.height, lineCount: metrics.lines, html: bodyHtml };
}

// Fixes widow/orphan: last line with a single word gets &nbsp; joining it to
// the previous word. Applied at the plain-text level before highlighting is
// not possible here (html already built), so we operate on the paragraph's
// trailing whitespace between the last two "words" via a light heuristic on
// the HTML string: replace the last space between two words (ignoring tags)
// near the end with &nbsp;. This is best-effort per spec ("insert &nbsp;
// between the last two words").
function applyWidowFix(paragraphHtml: string): { html: string; changed: boolean } {
  // Find the last space that separates two word-like runs before the end of string / </b> tags.
  const idx = paragraphHtml.lastIndexOf(" ");
  if (idx === -1) return { html: paragraphHtml, changed: false };
  // Avoid breaking inside a tag attribute (should not occur, no attrs w/ spaces here besides class="...").
  const before = paragraphHtml.slice(0, idx);
  const after = paragraphHtml.slice(idx + 1);
  if (/class="[^"]*$/.test(before)) return { html: paragraphHtml, changed: false };
  return { html: before + "&nbsp;" + after, changed: true };
}

export async function fitMioloParagraphs(
  page: Page,
  paragraphs: ParagraphUnit[],
  depth = 0
): Promise<FitResult[]> {
  if (paragraphs.length === 0) {
    return [{ ok: true, fontSizePx: FONT_MAX, html: "", lineCount: 0, widowCorrections: 0, sourceIndices: [] }];
  }

  const sourceIndices = paragraphs
    .map((p) => p.sourceIndex)
    .filter((i): i is number => i !== undefined);

  let fontSize = FONT_MAX;
  let fits = false;
  let lastMeasure = { height: 0, lineCount: 0, html: "" };

  while (fontSize >= FONT_MIN - 1e-9) {
    lastMeasure = await measure(page, paragraphs, fontSize);
    if (lastMeasure.height <= AREA_H) {
      fits = true;
      break;
    }
    fontSize = Math.round((fontSize - FONT_STEP) * 10) / 10;
  }

  if (fits) {
    // Widow/orphan pass: check each paragraph's last line. We only have a
    // coarse signal (scrollHeight), so we apply the &nbsp; heuristic to
    // every paragraph opportunistically and re-measure once; if that
    // overflows, back off one font-size step per spec.
    let widowCorrections = 0;
    const fixedParas = paragraphs.map((p) => {
      const { html, changed } = applyWidowFix(p.html);
      if (changed) widowCorrections++;
      return { ...p, html };
    });
    if (widowCorrections > 0) {
      const remeasure = await measure(page, fixedParas, fontSize);
      if (remeasure.height <= AREA_H) {
        return [
          {
            ok: true,
            fontSizePx: fontSize,
            html: remeasure.html,
            lineCount: remeasure.lineCount,
            widowCorrections,
            sourceIndices,
          },
        ];
      }
      // back off one step
      const backedOff = Math.max(FONT_MIN, Math.round((fontSize - FONT_STEP) * 10) / 10);
      const remeasure2 = await measure(page, paragraphs, backedOff);
      return [
        {
          ok: true,
          fontSizePx: backedOff,
          html: remeasure2.html,
          lineCount: remeasure2.lineCount,
          widowCorrections: 0,
          sourceIndices,
        },
      ];
    }
    return [
      {
        ok: true,
        fontSizePx: fontSize,
        html: lastMeasure.html,
        lineCount: lastMeasure.lineCount,
        widowCorrections: 0,
        sourceIndices,
      },
    ];
  }

  // Doesn't fit at FONT_MIN. Split at the paragraph boundary closest to the
  // vertical midpoint of content, never inside an atomic block.
  if (depth >= MAX_SPLIT_DEPTH) {
    return [
      {
        ok: false,
        fontSizePx: FONT_MIN,
        html: lastMeasure.html,
        lineCount: lastMeasure.lineCount,
        widowCorrections: 0,
        error: `Não coube após ${MAX_SPLIT_DEPTH} divisões (profundidade máxima atingida).`,
        sourceIndices,
      },
    ];
  }

  if (paragraphs.length === 1) {
    // Cannot split a single atomic paragraph further.
    return [
      {
        ok: false,
        fontSizePx: FONT_MIN,
        html: lastMeasure.html,
        lineCount: lastMeasure.lineCount,
        widowCorrections: 0,
        error: "Parágrafo único não cabe mesmo no tamanho mínimo (42px) e não pode ser dividido (bloco atômico).",
        sourceIndices,
      },
    ];
  }

  // Find split index closest to the midpoint by paragraph count (a
  // reasonable proxy for vertical midpoint of rendered content), skipping
  // indices that would separate an atomic block improperly. Atomic blocks
  // here are single paragraph units already (numbered lines / bible
  // quote+ref are kept together upstream when paragraphs are constructed),
  // so any paragraph boundary is a safe split point.
  const mid = Math.floor(paragraphs.length / 2);
  let splitAt = mid === 0 ? 1 : mid;
  // ensure we never split before an atomic paragraph in a way that separates it from itself (n/a, atomic units are whole paragraphs)
  splitAt = Math.max(1, Math.min(paragraphs.length - 1, splitAt));

  const firstHalf = paragraphs.slice(0, splitAt);
  const secondHalf = paragraphs.slice(splitAt);

  const firstResults = await fitMioloParagraphs(page, firstHalf, depth + 1);
  const secondResults = await fitMioloParagraphs(page, secondHalf, depth + 1);

  return [...firstResults, ...secondResults];
}
