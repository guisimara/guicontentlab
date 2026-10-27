"use client";

import { useMemo, useRef, useState } from "react";

type Focal =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

type Formato = "carrossel" | "estatico";

const FOCAL_GRID: Focal[] = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
];

interface QaCheck { id: string; label: string; pass: boolean; detail?: string }
interface CardReportEntry {
  filename: string;
  kind: "capa" | "miolo" | "cta";
  fontSizePx?: number;
  lineCount?: number;
  highlights?: { word: string; type: string }[];
  emojisRemoved?: number;
  widowCorrections?: number;
  errors?: string[];
}
interface JobReport {
  jobId: string;
  createdAt: string;
  warnings: string[];
  cards: CardReportEntry[];
  qa: QaCheck[];
  qaPassed: boolean;
}
interface Preview { filename: string; base64: string }

function preAnalyze(copyText: string) {
  const hasMarkers = /\[(CAPA|MIOLO|CTA)\]/i.test(copyText);
  const blocks = copyText
    .split(hasMarkers ? /\[(?:CAPA|MIOLO|CTA)\]/i : /\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const mioloBlocks = hasMarkers
    ? blocks.slice(1, -1).flatMap((b) => b.split(/^\s*---\s*$/m)).filter((b) => b.trim())
    : blocks.slice(1, -1);
  const longCards = mioloBlocks.filter((b) => b.length > 420).length;
  return {
    hasMarkers,
    totalCardsEstimate: blocks.length,
    mioloCount: mioloBlocks.length,
    likelySplits: longCards,
  };
}

export default function Page() {
  const [copyText, setCopyText] = useState("");
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [ctaFile, setCtaFile] = useState<File | null>(null);
  const [capaPreviewUrl, setCapaPreviewUrl] = useState<string | null>(null);
  const [ctaPreviewUrl, setCtaPreviewUrl] = useState<string | null>(null);
  const [capaFocal, setCapaFocal] = useState<Focal>("center");
  const [ctaFocal, setCtaFocal] = useState<Focal>("center");
  const [formato, setFormato] = useState<Formato>("carrossel");
  const [showReadCaptionTag, setShowReadCaptionTag] = useState(false);

  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<JobReport | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Preview | null>(null);
  const [downloadOverride, setDownloadOverride] = useState(false);

  const capaInputRef = useRef<HTMLInputElement>(null);
  const ctaInputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => (copyText.trim() ? preAnalyze(copyText) : null), [copyText]);

  function handleFile(file: File | null, which: "capa" | "cta") {
    if (which === "capa") {
      setCapaFile(file);
      setCapaPreviewUrl(file ? URL.createObjectURL(file) : null);
    } else {
      setCtaFile(file);
      setCtaPreviewUrl(file ? URL.createObjectURL(file) : null);
    }
  }

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    setDownloadOverride(false);
    try {
      const fd = new FormData();
      fd.set("copyText", copyText);
      fd.set("capaFocalPoint", capaFocal);
      fd.set("ctaFocalPoint", ctaFocal);
      fd.set("format", formato);
      fd.set("showReadCaptionTag", String(showReadCaptionTag));
      if (capaFile) fd.set("capaImage", capaFile);
      if (ctaFile && formato === "carrossel") fd.set("ctaImage", ctaFile);

      const res = await fetch("/api/render", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha ao gerar as artes.");
        if (data.report) setReport(data.report);
        setLoading(false);
        return;
      }
      setReport(data.report);
      setPreviews(data.previews);
      setJobId(data.jobId);
    } catch (err: any) {
      setError(`Erro de conexão: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadZip() {
    if (!jobId) return;
    window.location.href = `/api/zip?jobId=${jobId}`;
  }

  const canDownload = report ? report.qaPassed || downloadOverride : false;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <h1 className="text-2xl font-medium tracking-tight">CONTENT LAB | Gui Simara</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cole a copy, envie as imagens de capa (e CTA, se for carrossel), e gere as artes finais em 1080x1350.
        </p>
      </header>

      {/* 1. Formato */}
      <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Formato do conteúdo</h2>
        <BulletSelect
          value={formato}
          onChange={setFormato}
          options={[
            { value: "carrossel", label: "Carrossel", description: "Capa + miolo(s) + CTA" },
            { value: "estatico", label: "Estático", description: "Apenas a capa, 1 imagem" },
          ]}
        />

        <h2 className="mb-3 mt-6 text-sm font-medium text-neutral-700">Tag "leia a legenda" na capa</h2>
        <BulletSelect
          value={showReadCaptionTag ? "com" : "sem"}
          onChange={(v) => setShowReadCaptionTag(v === "com")}
          options={[
            { value: "sem", label: "Sem tag", description: "Capa limpa, sem selo" },
            { value: "com", label: "Com tag", description: "Placeholder até o PNG final ser enviado" },
          ]}
        />
      </section>

      {/* 2. Input */}
      <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Copy {formato === "estatico" ? "da capa" : "do carrossel"}</h2>
        <textarea
          value={copyText}
          onChange={(e) => setCopyText(e.target.value)}
          rows={12}
          placeholder={
            formato === "estatico"
              ? "[CAPA]\nFrase da capa aqui"
              : "[CAPA]\nFrase da capa aqui\n\n[MIOLO]\nTexto do card 2\n\n---\n\nTexto do card 3\n\n[CTA]\nFrase do CTA aqui"
          }
          className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed outline-none focus:border-neutral-400"
        />

        <div className={`mt-6 grid grid-cols-1 gap-6 ${formato === "carrossel" ? "sm:grid-cols-2" : ""}`}>
          <ImageUploader
            label="Imagem de capa (obrigatória)"
            previewUrl={capaPreviewUrl}
            onFile={(f) => handleFile(f, "capa")}
            focal={capaFocal}
            onFocal={setCapaFocal}
            inputRef={capaInputRef}
          />
          {formato === "carrossel" && (
            <ImageUploader
              label="Imagem de CTA (opcional — se ausente, reaproveita a da capa)"
              previewUrl={ctaPreviewUrl}
              onFile={(f) => handleFile(f, "cta")}
              focal={ctaFocal}
              onFocal={setCtaFocal}
              inputRef={ctaInputRef}
            />
          )}
        </div>
      </section>

      {/* 3. Pre-analysis */}
      {analysis && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Pré-análise</h2>
          <ul className="space-y-1 text-sm text-neutral-600">
            <li>Cards detectados (estimativa): {analysis.totalCardsEstimate}</li>
            {formato === "carrossel" && <li>Cards de miolo: {analysis.mioloCount}</li>}
            {formato === "carrossel" && (
              <li>
                Cards com possível necessidade de divisão (estimativa por tamanho de texto):{" "}
                {analysis.likelySplits}
              </li>
            )}
            {!analysis.hasMarkers && (
              <li className="text-amber-700">
                Nenhum marcador [CAPA]/[MIOLO]/[CTA] encontrado — o primeiro bloco será tratado como
                capa{formato === "carrossel" ? ", o último como CTA, e o restante como miolo" : ""}.
              </li>
            )}
            {!capaFile && <li className="text-amber-700">Imagem de capa ainda não enviada.</li>}
            {formato === "carrossel" && !ctaFile && (
              <li className="text-neutral-500">Imagem de CTA não enviada — será reaproveitada a da capa.</li>
            )}
          </ul>

          <label className="mt-4 flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Revisei a pré-análise e quero gerar as artes.
          </label>

          <button
            onClick={handleGenerate}
            disabled={!confirmed || !capaFile || loading}
            className="mt-4 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {loading ? "Gerando..." : "Gerar artes"}
          </button>
        </section>
      )}

      {error && (
        <section className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {error}
        </section>
      )}

      {/* 4. Preview */}
      {previews.length > 0 && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-700">Prévia</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {previews.map((p) => (
              <button
                key={p.filename}
                onClick={() => setLightbox(p)}
                className="group overflow-hidden rounded-lg border border-neutral-200 text-left"
              >
                <img
                  src={`data:image/png;base64,${p.base64}`}
                  alt={p.filename}
                  className="aspect-[4/5] w-full object-cover"
                />
                <div className="px-2 py-1 text-xs text-neutral-500">{p.filename}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 5. QA report */}
      {report && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Checklist de QA</h2>
          <ul className="space-y-1.5 text-sm">
            {report.qa.map((q) => (
              <li key={q.id} className="flex items-start gap-2">
                <span className={q.pass ? "text-green-600" : "text-red-600"}>{q.pass ? "✓" : "✗"}</span>
                <span>
                  {q.label}
                  {q.detail && <span className="ml-1 text-neutral-500">— {q.detail}</span>}
                </span>
              </li>
            ))}
          </ul>

          {report.warnings.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 font-medium">Avisos</div>
              <ul className="list-disc pl-5">
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {!report.qaPassed && (
            <label className="mt-4 flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={downloadOverride}
                onChange={(e) => setDownloadOverride(e.target.checked)}
              />
              Eu entendo os problemas, baixar mesmo assim.
            </label>
          )}
        </section>
      )}

      {/* 6. Download */}
      {jobId && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6">
          <button
            onClick={handleDownloadZip}
            disabled={!canDownload}
            className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Baixar ZIP
          </button>
          {!canDownload && (
            <p className="mt-2 text-xs text-neutral-500">
              O checklist de QA encontrou problemas. Marque a confirmação acima para baixar mesmo assim.
            </p>
          )}
        </section>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            src={`data:image/png;base64,${lightbox.base64}`}
            alt={lightbox.filename}
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}

function BulletSelect<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description: string }[];
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
      {props.options.map((opt) => {
        const active = props.value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => props.onChange(opt.value)}
            className={`flex flex-1 items-start gap-3 rounded-xl border p-3 text-left transition ${
              active ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white"
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                active ? "border-neutral-900" : "border-neutral-300"
              }`}
            >
              {active && <span className="h-2 w-2 rounded-full bg-neutral-900" />}
            </span>
            <span>
              <span className="block text-sm font-medium text-neutral-800">{opt.label}</span>
              <span className="block text-xs text-neutral-500">{opt.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ImageUploader(props: {
  label: string;
  previewUrl: string | null;
  onFile: (f: File | null) => void;
  focal: Focal;
  onFocal: (f: Focal) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-neutral-600">{props.label}</label>
      <input
        ref={props.inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => props.onFile(e.target.files?.[0] || null)}
        className="mb-3 block w-full text-sm"
      />
      {props.previewUrl && (
        <div className="mb-3 overflow-hidden rounded-lg border border-neutral-200">
          <img src={props.previewUrl} alt="preview" className="aspect-[4/5] w-full object-cover" />
        </div>
      )}
      <div className="grid w-24 grid-cols-3 gap-1">
        {FOCAL_GRID.map((pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => props.onFocal(pos)}
            className={`h-7 w-7 rounded ${props.focal === pos ? "bg-neutral-900" : "bg-neutral-200"}`}
            aria-label={pos}
          />
        ))}
      </div>
    </div>
  );
}
