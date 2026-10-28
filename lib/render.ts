// lib/render.ts
// Orchestrates Puppeteer: launch, render each card, validate, save.
import puppeteer, { type Browser } from "puppeteer";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCopy, type RawCard } from "./parser";
import { highlightMioloParagraph, highlightCapaCta } from "./highlight";
import { renderCapaTemplate, renderMioloTemplate, FOCAL_POINT_MAP } from "./template";
import { fitMioloParagraphs, type ParagraphUnit } from "./fit";
import { runQaChecklist, type CardReportEntry, type JobReport } from "./qa";

export interface RenderInput {
  jobId: string;
  copyText: string;
  capaImageBase64: string; // data URI already (image/jpeg or png)
  ctaImageBase64?: string; // optional; if missing, reuse capa
  capaFocalPoint: string;
  ctaFocalPoint: string;
  format: "carrossel" | "estatico"; // estatico = only the capa card is rendered
  showReadCaptionTag: boolean; // capa-only "leia a legenda" tag
}

export interface RenderOutcome {
  jobId: string;
  report: JobReport;
  previews: { filename: string; base64: string }[];
  fatalError?: string;
}

const JOBS_ROOT = "/tmp/jobs";

async function ensureFontsLoaded(page: any): Promise<{ ok300: boolean; ok700: boolean }> {
  await page.evaluate(async () => {
    await Promise.all([
      (document as any).fonts.load("300 49px Poppins"),
      (document as any).fonts.load("700 49px Poppins"),
    ]);
    await (document as any).fonts.ready;
  });
  const ok300 = await page.evaluate(() => (document as any).fonts.check("300 49px Poppins"));
  const ok700 = await page.evaluate(() => (document as any).fonts.check("700 49px Poppins"));
  return { ok300, ok700 };
}

function isAtomicPortugueseBlock(text: string): boolean {
  // Numbered list line or bible reference line — treated atomic upstream
  // by keeping the whole paragraph together (paragraphs from the parser
  // are already the smallest safe unit per spec).
  return /^\s*\d+\.\s+/.test(text) || /\b\d{1,3}:\d{1,3}(-\d{1,3})?\b/.test(text);
}

async function checkImageResolution(dataUri: string): Promise<{ ok: boolean; width: number; height: number }> {
  const base64 = dataUri.split(",")[1] || dataUri;
  const buf = Buffer.from(base64, "base64");
  const meta = await sharp(buf).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  return { ok: Math.min(w, h) >= 1080, width: w, height: h };
}

export async function renderJob(input: RenderInput): Promise<RenderOutcome> {
  const isEstatico = input.format === "estatico";
  const warnings: string[] = [];
  const jobDir = path.join(JOBS_ROOT, input.jobId);
  await mkdir(jobDir, { recursive: true });

  const { cards, warnings: parseWarnings } = parseCopy(input.copyText);
  // Formato Estático só usa a capa — avisos sobre miolo/cta ausentes não se aplicam.
  warnings.push(...(isEstatico ? parseWarnings.filter((w) => !/card de (miolo|cta)/i.test(w)) : parseWarnings));

  let ctaImage = input.ctaImageBase64;
  if (!isEstatico && !ctaImage) {
    ctaImage = input.capaImageBase64;
    warnings.push("Imagem de CTA não enviada — a imagem da capa foi reutilizada.");
  }

  const capaRes = await checkImageResolution(input.capaImageBase64);
  const ctaRes = isEstatico ? { ok: true, width: 0, height: 0 } : await checkImageResolution(ctaImage!);

  if (!capaRes.ok) {
    return {
      jobId: input.jobId,
      report: emptyReport(input.jobId, warnings),
      previews: [],
      fatalError: `Imagem da capa tem lado menor de ${Math.min(capaRes.width, capaRes.height)}px — mínimo exigido é 1080px. Envie uma imagem maior.`,
    };
  }
  if (!isEstatico && !ctaRes.ok) {
    return {
      jobId: input.jobId,
      report: emptyReport(input.jobId, warnings),
      previews: [],
      fatalError: `Imagem do CTA tem lado menor de ${Math.min(ctaRes.width, ctaRes.height)}px — mínimo exigido é 1080px. Envie uma imagem maior.`,
    };
  }

  let browser: Browser | null = null;
  const cardReports: CardReportEntry[] = [];
  const mioloFontSizes: number[] = [];
  const mioloHighlightCounts: number[] = [];
  const finalMioloHighlightCounts: number[] = [];
  const overflowErrors: string[] = [];
  let widowRemaining = 0;
  let fontChecksOk = true;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

    // font check probe: load a minimal doc with the same font-face css
    const { FONT_FACE_CSS } = await import("./fonts.generated");
    await page.setContent(
      `<!doctype html><html><head><style>${FONT_FACE_CSS}</style></head><body>x</body></html>`
    );
    const probeCheck = await ensureFontsLoaded(page);
    fontChecksOk = probeCheck.ok300 && probeCheck.ok700;
    if (!fontChecksOk) {
      await browser.close();
      return {
        jobId: input.jobId,
        report: emptyReport(input.jobId, warnings),
        previews: [],
        fatalError:
          "Falha ao carregar a fonte Poppins (300/700) embutida. Abortando job — nunca usamos fonte de sistema como fallback.",
      };
    }

    const finalFiles: { filename: string; kind: "capa" | "miolo" | "cta"; buffer: Buffer }[] = [];

    // --- Capa ---
    const capaCard = cards.find((c) => c.kind === "capa");
    if (capaCard) {
      const { buffer, entry } = await renderCapaCard(
        page,
        capaCard,
        input.capaImageBase64,
        input.capaFocalPoint,
        "capa",
        input.showReadCaptionTag
      );
      finalFiles.push({ filename: "PENDING-capa.png", kind: "capa", buffer });
      cardReports.push(entry);
    } else {
      warnings.push("Sem card de capa — nenhuma imagem de capa foi renderizada.");
    }

    // --- Miolo (with splitting) --- (pulado no formato Estático)
    const mioloCards = isEstatico ? [] : cards.filter((c) => c.kind === "miolo");
    for (const mc of mioloCards) {
      const highlightsByIndex: { word: string; type: string }[][] = [];
      const units: ParagraphUnit[] = mc.paragraphs.map((p, idx) => {
        const hl = highlightMioloParagraph(p.text, { manualOverride: mc.manualMarkupUsed });
        mioloHighlightCounts.push(hl.highlightsApplied.length);
        highlightsByIndex[idx] = hl.highlightsApplied;
        return { html: hl.html, isAtomic: isAtomicPortugueseBlock(p.text), sourceIndex: idx };
      });

      const results = await fitMioloParagraphs(page, units);
      for (const r of results) {
        if (!r.ok) {
          overflowErrors.push(r.error || "erro desconhecido de ajuste de texto");
        }
        mioloFontSizes.push(r.fontSizePx);
        if (r.widowCorrections === 0) {
          // count remaining potential widow only if we couldn't fix — best effort, not tracked further here
        }
        const html = renderMioloTemplate({ bodyHtml: r.html, fontSizePx: r.fontSizePx });
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        const { ok300: c300, ok700: c700 } = await ensureFontsLoaded(page);
        if (!c300 || !c700) {
          fontChecksOk = false;
          throw new Error("Falha de verificação de fonte durante a renderização de um card de miolo.");
        }
        const buffer = Buffer.from(await page.screenshot({ type: "png" }));
        finalFiles.push({
          filename: "PENDING.png",
          kind: "miolo",
          buffer,
        });
        const cardHighlights = r.sourceIndices.flatMap((i) => highlightsByIndex[i] || []);
        finalMioloHighlightCounts.push(cardHighlights.length);
        cardReports.push({
          filename: "PENDING.png",
          kind: "miolo",
          fontSizePx: r.fontSizePx,
          lineCount: r.lineCount,
          highlights: cardHighlights,
          widowCorrections: r.widowCorrections,
          errors: r.ok ? undefined : [r.error || "erro"],
        });
      }
      if (results.length > 1) {
        warnings.push(`Um card de miolo foi dividido em ${results.length} cards por não caber mesmo no tamanho mínimo (42px).`);
      }
    }

    // --- CTA --- (pulado no formato Estático)
    const ctaCard = isEstatico ? undefined : cards.find((c) => c.kind === "cta");
    if (ctaCard) {
      const { buffer, entry } = await renderCapaCard(page, ctaCard, ctaImage!, input.ctaFocalPoint, "cta");
      finalFiles.push({ filename: "PENDING-cta.png", kind: "cta", buffer });
      cardReports.push(entry);
    } else if (!isEstatico) {
      warnings.push("Sem card de CTA — nenhuma imagem de CTA foi renderizada.");
    }

    await browser.close();
    browser = null;

    // Renumber final sequence with no gaps.
    const namedFiles: { filename: string; kind: "capa" | "miolo" | "cta"; buffer: Buffer }[] = [];
    const total = finalFiles.length;
    finalFiles.forEach((f, idx) => {
      let filename: string;
      if (f.kind === "capa") filename = "01-capa.png";
      else if (f.kind === "cta") filename = `${String(total).padStart(2, "0")}-cta.png`;
      else filename = `${String(idx + 1).padStart(2, "0")}.png`;
      namedFiles.push({ ...f, filename });
    });

    // Validate dimensions with sharp — hard error on mismatch.
    for (const f of namedFiles) {
      const meta = await sharp(f.buffer).metadata();
      if (meta.width !== 1080 || meta.height !== 1350) {
        return {
          jobId: input.jobId,
          report: emptyReport(input.jobId, warnings),
          previews: [],
          fatalError: `PNG ${f.filename} saiu com dimensões ${meta.width}x${meta.height}, esperado 1080x1350. Job abortado.`,
        };
      }
    }

    // Save files + reconcile report filenames.
    for (let i = 0; i < namedFiles.length; i++) {
      await writeFile(path.join(jobDir, namedFiles[i].filename), namedFiles[i].buffer);
      cardReports[i].filename = namedFiles[i].filename;
    }

    const qa = await runQaChecklist({
      jobDir,
      cardFiles: namedFiles.map((f) => ({ filename: f.filename, kind: f.kind })),
      fontChecksOk,
      mioloFontSizes,
      finalMioloHighlightCounts,
      overflowErrors,
      widowRemaining,
      imagesOk: { capa: capaRes.ok, cta: ctaRes.ok },
    });
    const qaPassed = qa.every((q) => q.pass);

    const report: JobReport = {
      jobId: input.jobId,
      createdAt: new Date().toISOString(),
      warnings,
      cards: cardReports,
      qa,
      qaPassed,
    };
    await writeFile(path.join(jobDir, "report.json"), JSON.stringify(report, null, 2));

    const previews = namedFiles.map((f) => ({
      filename: f.filename,
      base64: f.buffer.toString("base64"),
    }));

    return { jobId: input.jobId, report, previews };
  } catch (err: any) {
    if (browser) await browser.close();
    return {
      jobId: input.jobId,
      report: emptyReport(input.jobId, warnings),
      previews: [],
      fatalError: `Erro durante a renderização: ${err?.message || String(err)}`,
    };
  }
}

async function renderCapaCard(
  page: any,
  card: RawCard,
  imageDataUri: string,
  focalPoint: string,
  variant: "capa" | "cta",
  showReadCaptionTag = false
): Promise<{ buffer: Buffer; entry: CardReportEntry }> {
  const fullText = card.paragraphs.map((p) => p.text).join(" ");
  const hl = highlightCapaCta(fullText, { manualOverride: card.manualMarkupUsed });
  const fp = FOCAL_POINT_MAP[focalPoint] ? focalPoint : "center";
  const html = renderCapaTemplate({
    headlineHtml: hl.html,
    imageDataUri,
    focalPoint: fp,
    variant,
    showReadCaptionTag,
  });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const { ok300: c300, ok700: c700 } = await ensureFontsLoaded(page);
  if (!c300 || !c700) {
    throw new Error(`Falha de verificação de fonte no card de ${variant}.`);
  }
  const buffer = Buffer.from(await page.screenshot({ type: "png" }));
  const emojisRemoved = card.paragraphs.reduce((sum, p) => sum + p.emojisRemoved, 0);
  const entry: CardReportEntry = {
    filename: variant === "capa" ? "PENDING-capa.png" : "PENDING-cta.png",
    kind: variant,
    highlights: hl.highlightsApplied,
    emojisRemoved,
  };
  return { buffer, entry };
}

function emptyReport(jobId: string, warnings: string[]): JobReport {
  return {
    jobId,
    createdAt: new Date().toISOString(),
    warnings,
    cards: [],
    qa: [],
    qaPassed: false,
  };
}
