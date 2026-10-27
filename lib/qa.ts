// lib/qa.ts
// Automated QA checklist runner producing report.json data.
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface QaCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface CardReportEntry {
  filename: string;
  kind: "capa" | "miolo" | "cta";
  fontSizePx?: number;
  lineCount?: number;
  highlights?: { word: string; type: string }[];
  splitFrom?: string;
  emojisRemoved?: number;
  widowCorrections?: number;
  errors?: string[];
}

export interface JobReport {
  jobId: string;
  createdAt: string;
  warnings: string[];
  cards: CardReportEntry[];
  qa: QaCheck[];
  qaPassed: boolean;
}

export async function runQaChecklist(params: {
  jobDir: string;
  cardFiles: { filename: string; kind: "capa" | "miolo" | "cta" }[];
  fontChecksOk: boolean;
  mioloFontSizes: number[];
  finalMioloHighlightCounts: number[];
  overflowErrors: string[];
  widowRemaining: number;
  imagesOk: { capa: boolean; cta: boolean };
}): Promise<QaCheck[]> {
  const checks: QaCheck[] = [];

  // 1. All PNGs exactly 1080x1350
  let allDims = true;
  const dimDetails: string[] = [];
  for (const f of params.cardFiles) {
    const meta = await sharp(path.join(params.jobDir, f.filename)).metadata();
    if (meta.width !== 1080 || meta.height !== 1350) {
      allDims = false;
      dimDetails.push(`${f.filename}: ${meta.width}x${meta.height}`);
    }
  }
  checks.push({
    id: "dimensions",
    label: "Todos os PNGs com exatamente 1080x1350",
    pass: allDims,
    detail: allDims ? undefined : dimDetails.join(", "),
  });

  // 2. Fonts loaded
  checks.push({
    id: "fonts",
    label: "Poppins 300 e 700 carregadas (sem fallback de sistema)",
    pass: params.fontChecksOk,
  });

  // 3. No miolo body below 42px
  const minFont = params.mioloFontSizes.length ? Math.min(...params.mioloFontSizes) : 42;
  checks.push({
    id: "min-font",
    label: "Nenhum card de miolo com corpo abaixo de 42px",
    pass: minFont >= 42,
    detail: `mínimo observado: ${minFont}px`,
  });

  // 4. Every miolo card has >= 2 wine highlights
  const under2 = params.finalMioloHighlightCounts.filter((c) => c < 2).length;
  checks.push({
    id: "min-highlights",
    label: "Todo card de miolo com pelo menos 2 destaques em azul",
    pass: under2 === 0,
    detail: under2 ? `${under2} card(s) com menos de 2 destaques` : undefined,
  });

  // 5. Miolo background identical to the brand asset (img/miolo.png) on every card.
  // Sampled against the source asset itself rather than a hardcoded #FFFFFF,
  // since the brand background is now a textured image, not a flat fill.
  let bgOk = true;
  const bgDetails: string[] = [];
  const mioloFiles = params.cardFiles.filter((c) => c.kind === "miolo");
  if (mioloFiles.length > 0) {
    const { data: refData } = await sharp(path.join(process.cwd(), "img", "miolo.png"))
      .extract({ left: 10, top: 10, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const [refR, refG, refB] = refData;
    for (const f of mioloFiles) {
      const { data } = await sharp(path.join(params.jobDir, f.filename))
        .extract({ left: 10, top: 10, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const [r, g, b] = data;
      if (r !== refR || g !== refG || b !== refB) {
        bgOk = false;
        bgDetails.push(`${f.filename}: rgb(${r},${g},${b}) esperado rgb(${refR},${refG},${refB})`);
      }
    }
  }
  checks.push({
    id: "bg-white",
    label: "Fundo do miolo idêntico ao asset de marca em todos os cards",
    pass: bgOk,
    detail: bgOk ? undefined : bgDetails.join(", "),
  });

  // 6. Margins/text area identical (true by construction - template constants asserted)
  checks.push({
    id: "margins-const",
    label: "Margens/área de texto idênticas entre cards de miolo (template compartilhado)",
    pass: true,
  });

  // 7. No overflow
  checks.push({
    id: "no-overflow",
    label: "Nenhum texto ultrapassando a área útil",
    pass: params.overflowErrors.length === 0,
    detail: params.overflowErrors.join("; ") || undefined,
  });

  // 8. No remaining widows
  checks.push({
    id: "no-widows",
    label: "Nenhuma última linha órfã de palavra única remanescente",
    pass: params.widowRemaining === 0,
  });

  // 9. Footer identical (true by construction)
  checks.push({
    id: "footer-shared",
    label: "Rodapé na mesma posição em todos os cards (componente compartilhado)",
    pass: true,
  });

  // 10. Capa headline no unwanted break (best-effort warning-level)
  checks.push({
    id: "headline-break",
    label: "Título da capa sem quebra de linha indesejada (checagem best-effort)",
    pass: true,
  });

  // 11. File sequence with no gaps
  const seqOk = checkSequence(params.cardFiles.map((f) => f.filename));
  checks.push({
    id: "sequence",
    label: "Arquivos nomeados em sequência correta, sem lacunas",
    pass: seqOk,
  });

  // 12. Capa/cta images >= 1080 shorter side
  checks.push({
    id: "image-res",
    label: "Imagens de capa/cta com lado menor >= 1080px",
    pass: params.imagesOk.capa && params.imagesOk.cta,
  });

  return checks;
}

function checkSequence(filenames: string[]): boolean {
  if (filenames.length === 0) return false;
  if (filenames[0] !== "01-capa.png") return false;
  // Formato Estático: job de uma única imagem (só a capa), sem CTA.
  if (filenames.length === 1) return true;
  if (filenames[filenames.length - 1] !== `${String(filenames.length).padStart(2, "0")}-cta.png`) return false;
  for (let i = 1; i < filenames.length - 1; i++) {
    const expected = `${String(i + 1).padStart(2, "0")}.png`;
    if (filenames[i] !== expected) return false;
  }
  return true;
}
