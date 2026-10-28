import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { renderJob } from "@/lib/render";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const copyText = String(form.get("copyText") || "");
    const capaFocalPoint = String(form.get("capaFocalPoint") || "center");
    const ctaFocalPoint = String(form.get("ctaFocalPoint") || "center");
    const jobId = String(form.get("jobId") || randomUUID());
    const format = String(form.get("format") || "carrossel") === "estatico" ? "estatico" : "carrossel";
    const showReadCaptionTag = String(form.get("showReadCaptionTag") || "false") === "true";
    const tagText = String(form.get("tagText") || "").trim() || undefined;

    const capaFile = form.get("capaImage") as File | null;
    const ctaFile = form.get("ctaImage") as File | null;

    if (!copyText.trim()) {
      return NextResponse.json({ error: "O texto da copy está vazio. Cole o texto do carrossel para continuar." }, { status: 400 });
    }
    if (!capaFile) {
      return NextResponse.json({ error: "Nenhuma imagem de capa foi enviada. A imagem de capa é obrigatória." }, { status: 400 });
    }

    const capaImageBase64 = await fileToDataUri(capaFile);
    const ctaImageBase64 = ctaFile ? await fileToDataUri(ctaFile) : undefined;

    const outcome = await renderJob({
      jobId,
      copyText,
      capaImageBase64,
      ctaImageBase64,
      capaFocalPoint,
      ctaFocalPoint,
      format,
      showReadCaptionTag,
      tagText,
    });

    if (outcome.fatalError) {
      return NextResponse.json({ error: outcome.fatalError, report: outcome.report }, { status: 422 });
    }

    return NextResponse.json({
      jobId: outcome.jobId,
      report: outcome.report,
      previews: outcome.previews,
      cardsText: outcome.cardsText,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Erro inesperado: ${err?.message || String(err)}` }, { status: 500 });
  }
}

async function fileToDataUri(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
