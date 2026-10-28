import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { isDriveConnected, uploadJobToDrive } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { jobId } = await req.json().catch(() => ({ jobId: null }));
  if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) {
    return NextResponse.json({ error: "jobId inválido ou ausente." }, { status: 400 });
  }
  const jobDir = path.join("/tmp/jobs", jobId);
  if (!existsSync(jobDir)) {
    return NextResponse.json({ error: "Job não encontrado. Gere as artes novamente." }, { status: 404 });
  }

  if (!isDriveConnected()) {
    return NextResponse.json({ error: "Drive não conectado.", needsAuth: true }, { status: 401 });
  }

  try {
    const result = await uploadJobToDrive(jobId);
    return NextResponse.json({
      folderUrl: result.folderUrl,
      uploadedCount: result.uploadedFiles.length,
    });
  } catch (err: any) {
    if (err?.message === "DRIVE_NOT_CONNECTED") {
      return NextResponse.json({ error: "Drive não conectado.", needsAuth: true }, { status: 401 });
    }
    return NextResponse.json({ error: `Falha ao enviar para o Drive: ${err?.message || String(err)}` }, { status: 500 });
  }
}
