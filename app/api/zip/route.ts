import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import archiver from "archiver";
import { PassThrough } from "node:stream";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) {
    return NextResponse.json({ error: "jobId inválido ou ausente." }, { status: 400 });
  }
  const jobDir = path.join("/tmp/jobs", jobId);
  if (!existsSync(jobDir)) {
    return NextResponse.json({ error: "Job não encontrado. Gere as artes novamente." }, { status: 404 });
  }

  const files = await readdir(jobDir);
  const stream = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => stream.destroy(err));
  archive.pipe(stream);
  for (const f of files) {
    archive.file(path.join(jobDir, f), { name: f });
  }
  archive.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const zipBuffer = Buffer.concat(chunks);

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${jobId}.zip"`,
    },
  });
}
