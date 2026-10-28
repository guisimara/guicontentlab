"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

const AZUL = "#0F3250";

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
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Preview | null>(null);

  const [driveConnected, setDriveConnected] = useState(false);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);

  const capaInputRef = useRef<HTMLInputElement>(null);
  const ctaInputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => (copyText.trim() ? preAnalyze(copyText) : null), [copyText]);

  // Handles the round-trip back from Google's OAuth consent screen: if the
  // user had clicked "Enviar para o Drive" before being connected, we stash
  // the jobId in sessionStorage, send them to Google, and when they land
  // back here we restore the jobId and finish the upload automatically —
  // so from the user's point of view it's still a single click.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("driveAuth");
    if (authResult) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    const pendingJobId = sessionStorage.getItem("clg_pending_drive_jobId");

    if (authResult === "success" && pendingJobId) {
      sessionStorage.removeItem("clg_pending_drive_jobId");
      setJobId(pendingJobId);
      setDriveConnected(true);
      void sendToDrive(pendingJobId);
      return;
    }
    if (authResult === "denied") {
      sessionStorage.removeItem("clg_pending_drive_jobId");
      setDriveError("Autorização negada — não foi possível conectar ao Drive.");
    } else if (authResult === "error") {
      sessionStorage.removeItem("clg_pending_drive_jobId");
      setDriveError("Erro ao conectar ao Drive. Tente novamente.");
    }

    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then((d) => setDriveConnected(!!d.connected))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendToDrive(id: string) {
    setDriveUploading(true);
    setDriveError(null);
    setDriveFolderUrl(null);
    try {
      const res = await fetch("/api/drive-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsAuth) {
          sessionStorage.setItem("clg_pending_drive_jobId", id);
          window.location.href = "/api/auth/google";
          return;
        }
        setDriveError(data.error || "Falha ao enviar para o Drive.");
        return;
      }
      setDriveConnected(true);
      setDriveFolderUrl(data.folderUrl);
    } catch (err: any) {
      setDriveError(`Erro de conexão: ${err?.message || String(err)}`);
    } finally {
      setDriveUploading(false);
    }
  }

  function handleSendToDrive() {
    if (!jobId) return;
    void sendToDrive(jobId);
  }

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
    setDriveError(null);
    setDriveFolderUrl(null);
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
        setLoading(false);
        return;
      }
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

  return (
    <div className="mx-auto max-w-[1600px] px-10 py-8 2xl:px-20">
      {/* Header */}
      <header className="mb-6 flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: AZUL }}
        >
          GS
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">CONTENT LAB | Gui Simara</h1>
          <p className="text-xs text-neutral-500">Carrosséis e estáticos 1080×1350 em segundos</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: Step 1 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <StepBadge n={1} />
            <h2 className="text-sm font-medium text-neutral-800">Formato e copy</h2>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BulletSelect
              value={formato}
              onChange={setFormato}
              options={[
                { value: "carrossel", label: "Carrossel", description: "Capa + miolo(s) + CTA" },
                { value: "estatico", label: "Estático", description: "Apenas a capa" },
              ]}
            />
            <BulletSelect
              value={showReadCaptionTag ? "com" : "sem"}
              onChange={(v) => setShowReadCaptionTag(v === "com")}
              options={[
                { value: "sem", label: "Sem tag", description: '"Leia a legenda"' },
                { value: "com", label: "Com tag", description: "Placeholder" },
              ]}
            />
          </div>

          <textarea
            value={copyText}
            onChange={(e) => setCopyText(e.target.value)}
            rows={9}
            placeholder={
              formato === "estatico"
                ? "[CAPA]\nFrase da capa aqui"
                : "[CAPA]\nFrase da capa aqui\n\n[MIOLO]\nTexto do card 2\n\n---\n\nTexto do card 3\n\n[CTA]\nFrase do CTA aqui"
            }
            className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-sm leading-relaxed outline-none transition-colors focus:border-neutral-400"
          />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <ImageUploader
              label="Capa"
              previewUrl={capaPreviewUrl}
              onFile={(f) => handleFile(f, "capa")}
              focal={capaFocal}
              onFocal={setCapaFocal}
              inputRef={capaInputRef}
            />
            {formato === "carrossel" && (
              <ImageUploader
                label="CTA"
                previewUrl={ctaPreviewUrl}
                onFile={(f) => handleFile(f, "cta")}
                focal={ctaFocal}
                onFocal={setCtaFocal}
                inputRef={ctaInputRef}
              />
            )}
          </div>

          {analysis && (
            <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
                <span><b className="font-semibold text-neutral-800">{analysis.totalCardsEstimate}</b> cards estimados</span>
                {formato === "carrossel" && (
                  <span><b className="font-semibold text-neutral-800">{analysis.mioloCount}</b> de miolo</span>
                )}
                {formato === "carrossel" && analysis.likelySplits > 0 && (
                  <span className="text-amber-700">
                    <b className="font-semibold">{analysis.likelySplits}</b> podem dividir em 2 cards
                  </span>
                )}
              </div>
              {!analysis.hasMarkers && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Sem marcadores [CAPA]/[MIOLO]/[CTA] — o 1º bloco vira capa
                  {formato === "carrossel" ? ", o último vira CTA." : "."}
                </p>
              )}
              {formato === "carrossel" && !ctaFile && (
                <p className="mt-1.5 text-xs text-neutral-500">
                  Imagem de CTA não enviada — será reaproveitada a da capa.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="h-4 w-4"
                style={{ accentColor: AZUL }}
              />
              Revisei e quero gerar
            </label>
            <button
              onClick={handleGenerate}
              disabled={!confirmed || !capaFile || !copyText.trim() || loading}
              className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity disabled:opacity-40"
              style={{ backgroundColor: AZUL }}
            >
              {loading && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {loading ? "Gerando..." : "Gerar artes"}
            </button>
          </div>
          {!capaFile && (
            <p className="mt-2 text-right text-xs text-amber-700">Envie a imagem de capa para continuar.</p>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          )}
        </section>

        {/* Right column: Step 2 + Step 3 stacked */}
        <div className="flex flex-col gap-5">
          {previews.length > 0 && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <StepBadge n={2} />
                <h2 className="text-sm font-medium text-neutral-800">Prévia</h2>
                <span className="text-xs text-neutral-400">clique para ampliar</span>
              </div>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                {previews.map((p) => (
                  <button
                    key={p.filename}
                    onClick={() => setLightbox(p)}
                    className="group overflow-hidden rounded-xl border border-neutral-200 text-left transition-shadow hover:shadow-md"
                  >
                    <img
                      src={`data:image/png;base64,${p.base64}`}
                      alt={p.filename}
                      className="aspect-[4/5] w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                    <div className="truncate bg-white px-2 py-1 text-[10px] text-neutral-400">{p.filename}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {jobId && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex gap-3">
                <button
                  onClick={handleDownloadZip}
                  className="flex-1 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: AZUL }}
                >
                  Baixar ZIP
                </button>
                <button
                  onClick={handleSendToDrive}
                  disabled={driveUploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium shadow-sm transition-opacity disabled:opacity-50"
                  style={{ borderColor: AZUL, color: AZUL }}
                >
                  {driveUploading && (
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
                      style={{ borderColor: AZUL, borderTopColor: "transparent" }}
                    />
                  )}
                  {driveUploading
                    ? "Enviando..."
                    : driveConnected
                      ? "Enviar para o Drive"
                      : "Conectar e enviar ao Drive"}
                </button>
              </div>

              {driveFolderUrl && (
                <p className="mt-3 text-xs text-neutral-500">
                  Enviado com sucesso.{" "}
                  <a
                    href={driveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                    style={{ color: AZUL }}
                  >
                    Abrir pasta no Drive
                  </a>
                </p>
              )}
              {driveError && (
                <p className="mt-3 text-xs text-red-700">{driveError}</p>
              )}
            </section>
          )}

          {previews.length === 0 && !jobId && (
            <section className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white/50 p-5 text-center text-sm text-neutral-400">
              A prévia e o QA aparecem aqui depois de gerar as artes.
            </section>
          )}
        </div>
      </div>

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

function StepBadge(props: { n: number }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: AZUL }}
    >
      {props.n}
    </span>
  );
}

function BulletSelect<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description: string }[];
}) {
  return (
    <div className="flex flex-1 gap-2">
      {props.options.map((opt) => {
        const active = props.value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => props.onChange(opt.value)}
            className="flex flex-1 items-start gap-2 rounded-xl border p-2.5 text-left transition-colors"
            style={{
              borderColor: active ? AZUL : "#E5E5E5",
              backgroundColor: active ? "#F0F4F7" : "white",
            }}
          >
            <span
              className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
              style={{ borderColor: active ? AZUL : "#D4D4D4" }}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: AZUL }} />}
            </span>
            <span>
              <span className="block text-xs font-medium text-neutral-800">{opt.label}</span>
              <span className="block text-[10px] text-neutral-500">{opt.description}</span>
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
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-neutral-600">{props.label}</div>
      <div className="flex items-start gap-2">
        {props.previewUrl ? (
          <button
            type="button"
            onClick={() => props.inputRef.current?.click()}
            className="group relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-200"
          >
            <img src={props.previewUrl} alt="preview" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[9px] font-medium text-white opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
              trocar
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.inputRef.current?.click()}
            className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-neutral-400 hover:border-neutral-400 hover:text-neutral-500"
          >
            <span className="text-lg leading-none">+</span>
          </button>
        )}
        <input
          ref={props.inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => props.onFile(e.target.files?.[0] || null)}
          className="hidden"
        />

        <div className="grid grid-cols-3 gap-1">
          {FOCAL_GRID.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => props.onFocal(pos)}
              className="h-5 w-5 rounded transition-colors"
              style={{ backgroundColor: props.focal === pos ? AZUL : "#E5E5E5" }}
              aria-label={pos}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
