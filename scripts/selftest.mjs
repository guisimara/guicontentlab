// scripts/selftest.mjs
// Constructs a sample 6-card copy (with a deliberately long paragraph-heavy
// card to force a split), generates placeholder JPEG images with sharp,
// and runs it through the render pipeline directly via tsx-registered TS import.
import sharp from "sharp";
import path from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function makePlaceholderJpeg(filePath, color) {
  const width = 1200, height = 1500;
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i += 3) {
    const n = Math.floor(Math.random() * 40) - 20;
    noise[i] = Math.max(0, Math.min(255, color[0] + n));
    noise[i + 1] = Math.max(0, Math.min(255, color[1] + n));
    noise[i + 2] = Math.max(0, Math.min(255, color[2] + n));
  }
  await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg().toFile(filePath);
}

const longParagraph = Array.from({ length: 14 }, (_, i) =>
  `Este é um parágrafo longo número ${i + 1} feito de propósito para forçar o card a exceder a área útil de texto no tamanho máximo de fonte, testando assim o algoritmo de divisão automática de cards conforme a especificação travada do layout.`
).join("\n\n");

const copyText = `[CAPA]
A verdadeira **Fé** transforma tudo 🙏✨

[MIOLO]
Deus é fiel em todas as circunstâncias da vida.

Ele nunca nos abandona, mesmo quando tudo parece perdido.

---

1. Ore todos os dias
2. Leia a Palavra
3. Confie no Senhor

---

${longParagraph}

---

"Portanto, não temas, porque eu sou contigo."
Isaías 41:10

---

A oração muda tudo quando feita com fé genuína e coração aberto.

[CTA]
Siga para mais conteúdo sobre fé e propósito ✨
`;

async function run() {
  const jobId = `selftest-${randomUUID().slice(0, 8)}`;
  const tmpDir = path.join("/tmp", "selftest-assets");
  await mkdir(tmpDir, { recursive: true });
  const capaPath = path.join(tmpDir, "capa.jpg");
  const ctaPath = path.join(tmpDir, "cta.jpg");
  await makePlaceholderJpeg(capaPath, [40, 30, 60]);
  await makePlaceholderJpeg(ctaPath, [60, 20, 20]);

  const capaBuf = await readFile(capaPath);
  const ctaBuf = await readFile(ctaPath);

  const { renderJob } = await import(path.join(root, "lib", "render.ts"));

  const outcome = await renderJob({
    jobId,
    copyText,
    capaImageBase64: `data:image/jpeg;base64,${capaBuf.toString("base64")}`,
    ctaImageBase64: `data:image/jpeg;base64,${ctaBuf.toString("base64")}`,
    capaFocalPoint: "center",
    ctaFocalPoint: "center",
  });

  console.log("=== SELFTEST OUTCOME ===");
  if (outcome.fatalError) {
    console.error("FATAL ERROR:", outcome.fatalError);
    process.exit(1);
  }
  console.log("jobId:", outcome.jobId);
  console.log("card count:", outcome.report.cards.length);
  console.log(JSON.stringify(outcome.report, null, 2));
  console.log("=== QA PASSED:", outcome.report.qaPassed, "===");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
