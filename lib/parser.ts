// lib/parser.ts
// Parses the raw copy text into a structured card array.
// Never rewrites, summarizes, or corrects the user's text — only lays it out.

export type RawCardKind = "capa" | "miolo" | "cta";

export interface RawParagraph {
  text: string; // emoji-stripped text used for rendering
  emojisRemoved: number;
}

export interface RawCard {
  kind: RawCardKind;
  // Paragraphs as split by double-blank-line within a block.
  paragraphs: RawParagraph[];
  manualMarkupUsed: boolean; // true if **word** appears anywhere in this card
}

export interface ParseResult {
  cards: RawCard[];
  warnings: string[];
}

// Emoji stripping regex — covers the common emoji Unicode ranges plus
// variation selectors and the zero-width joiner used in combined emoji.
// DECISION: this is a broad-but-practical emoji range list, not the full
// Unicode emoji spec (documented in DECISIONS.md).
const EMOJI_REGEX =
  /([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{2190}-\u{21FF}]️|[⬀-⯿]|️|‍)/gu;

function stripEmojis(text: string): RawParagraph {
  const matches = text.match(EMOJI_REGEX);
  const emojisRemoved = matches ? matches.length : 0;
  const cleaned = text.replace(EMOJI_REGEX, "").replace(/[ \t]{2,}/g, " ").trimEnd();
  return { text: cleaned, emojisRemoved };
}

function splitParagraphs(block: string): RawParagraph[] {
  // Double blank line = paragraph break. Normalize line endings first.
  const normalized = block.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n\s*\n\s*\n|\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  // The regex above merges 2+ blank lines into paragraph splits (double
  // blank line spec == at least one fully blank line between paragraphs,
  // i.e. \n\n in the raw text since each line already ends with \n).
  return parts.map(stripEmojis);
}

function hasManualMarkup(raw: string): boolean {
  return /\*\*[^*]+\*\*/.test(raw);
}

export function parseCopy(rawInput: string): ParseResult {
  const warnings: string[] = [];
  const text = rawInput.replace(/\r\n/g, "\n");

  const hasMarkers = /^\s*\[(CAPA|MIOLO|CTA)\]\s*$/im.test(text);

  const cards: RawCard[] = [];

  if (hasMarkers) {
    // Split on marker lines, keeping track of which marker introduces each block.
    const lines = text.split("\n");
    type Block = { kind: RawCardKind; lines: string[] };
    const blocks: Block[] = [];
    let current: Block | null = null;
    for (const line of lines) {
      const m = line.match(/^\s*\[(CAPA|MIOLO|CTA)\]\s*$/i);
      if (m) {
        const kind = m[1].toLowerCase() as RawCardKind;
        current = { kind, lines: [] };
        blocks.push(current);
      } else if (current) {
        current.lines.push(line);
      }
      // lines before the first marker are ignored (shouldn't normally happen)
    }

    for (const block of blocks) {
      const blockText = block.lines.join("\n");
      if (block.kind === "miolo") {
        // A lone "---" on its own line separates miolo cards within this block.
        const subCards = blockText.split(/^\s*---\s*$/m);
        for (const sub of subCards) {
          const paragraphs = splitParagraphs(sub);
          if (paragraphs.length === 0) continue;
          cards.push({
            kind: "miolo",
            paragraphs,
            manualMarkupUsed: hasManualMarkup(sub),
          });
        }
      } else {
        const paragraphs = splitParagraphs(blockText);
        if (paragraphs.length === 0) continue;
        cards.push({
          kind: block.kind,
          paragraphs,
          manualMarkupUsed: hasManualMarkup(blockText),
        });
      }
    }
  } else {
    warnings.push(
      "Nenhum marcador [CAPA]/[MIOLO]/[CTA] encontrado — o primeiro bloco foi inferido como capa, o último como CTA, e os blocos do meio como miolo."
    );
    // Split the whole text by blank-line-separated blocks first, honoring "---" as a miolo separator too.
    const topBlocks = text
      .split(/\n\s*\n\s*\n|\n{2,}/g)
      .map((b) => b.trim())
      .filter(Boolean);

    if (topBlocks.length === 0) {
      return { cards: [], warnings: [...warnings, "Nenhum texto encontrado."] };
    }

    const capaBlock = topBlocks[0];
    const ctaBlock = topBlocks[topBlocks.length - 1];
    const middleBlocks = topBlocks.slice(1, Math.max(1, topBlocks.length - 1));

    cards.push({
      kind: "capa",
      paragraphs: [stripEmojis(capaBlock)],
      manualMarkupUsed: hasManualMarkup(capaBlock),
    });

    for (const block of middleBlocks) {
      const subCards = block.split(/^\s*---\s*$/m);
      for (const sub of subCards) {
        const p = stripEmojis(sub);
        if (!p.text) continue;
        cards.push({
          kind: "miolo",
          paragraphs: [p],
          manualMarkupUsed: hasManualMarkup(sub),
        });
      }
    }

    if (topBlocks.length > 1) {
      cards.push({
        kind: "cta",
        paragraphs: [stripEmojis(ctaBlock)],
        manualMarkupUsed: hasManualMarkup(ctaBlock),
      });
    }
  }

  if (!cards.some((c) => c.kind === "capa")) {
    warnings.push("Nenhum card de capa detectado.");
  }
  if (!cards.some((c) => c.kind === "cta")) {
    warnings.push("Nenhum card de CTA detectado.");
  }
  if (!cards.some((c) => c.kind === "miolo")) {
    warnings.push("Nenhum card de miolo detectado.");
  }

  return { cards, warnings };
}
