// lib/template.ts
// HTML+CSS string generator for a card (miolo, capa, cta).
// LOCKED layout numbers per spec — do not alter.
import { FONT_FACE_CSS } from "./fonts.generated";

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;

export const TOKENS = {
  branco: "#FFFFFF",
  preto: "#000000",
  vinho: "#6F0606",
};

// Deterministic grain texture: fixed seed via fixed feTurbulence params so
// every job/card produces an identical texture (not random per render).
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>
<filter id='n'>
<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/>
<feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0'/>
</filter>
<rect width='100%' height='100%' filter='url(#n)'/>
</svg>`;
const GRAIN_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(GRAIN_SVG).toString("base64")}`;

// Shadow band gradient stops per spec (alpha out of 255 -> decimal).
const SHADOW_GRADIENT =
  "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.102) 10%, rgba(0,0,0,0.200) 20%, rgba(0,0,0,0.251) 30%, rgba(0,0,0,0.302) 40%, rgba(0,0,0,0.353) 50%, rgba(0,0,0,0.302) 60%, rgba(0,0,0,0.251) 70%, rgba(0,0,0,0.200) 80%, rgba(0,0,0,0.102) 90%, rgba(0,0,0,0) 100%)";

export const FOCAL_POINT_MAP: Record<string, string> = {
  "top-left": "left top",
  "top-center": "center top",
  "top-right": "right top",
  "center-left": "left center",
  center: "center center",
  "center-right": "right center",
  "bottom-left": "left bottom",
  "bottom-center": "center bottom",
  "bottom-right": "right bottom",
};

// Shared base CSS (fonts + resets). Never varies per card.
function baseCss(): string {
  return `
    ${FONT_FACE_CSS}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${CANVAS_W}px; height: ${CANVAS_H}px; overflow: hidden; }
    body { font-family: 'Poppins', sans-serif; position: relative; }
    .card { width: ${CANVAS_W}px; height: ${CANVAS_H}px; position: relative; }
    .wine { color: ${TOKENS.vinho}; font-weight: 700; }
    .w700 { font-weight: 700; }
    .w300 { font-weight: 300; }
  `;
}

// Footer for miolo cards. Implemented ONCE, used verbatim on every miolo
// card — never re-derived per card.
export function mioloFooter(): string {
  return `
  <div class="footer-miolo">
    <div class="handle">@leticiafessel_</div>
    <div class="tagline">Feminilidade Bíblica</div>
    <div class="arrow">→</div>
    <div class="vbar"></div>
  </div>`;
}

export function mioloFooterCss(): string {
  return `
    .footer-miolo .handle {
      position: absolute; top: 1227px; left: 0; width: 100%;
      text-align: center; font-size: 28px; font-weight: 700; color: ${TOKENS.vinho};
    }
    .footer-miolo .tagline {
      position: absolute; top: 1257px; left: 0; width: 100%;
      text-align: center; font-size: 22px; font-weight: 300; color: ${TOKENS.vinho};
    }
    .footer-miolo .arrow {
      position: absolute; top: 1225px; right: 105px;
      font-size: 111px; color: ${TOKENS.vinho}; line-height: 1;
    }
    .footer-miolo .vbar {
      position: absolute; top: 1295px; left: 50%; transform: translateX(-50%);
      width: 4px; height: ${CANVAS_H - 1295}px; background: ${TOKENS.vinho};
    }
  `;
}

// Footer for capa/cta cards (different values + text-shadow, no tagline/vbar).
export function capaFooter(): string {
  return `
  <div class="footer-capa">
    <div class="handle">@leticiafessel_</div>
    <div class="arrow">→</div>
  </div>`;
}

export function capaFooterCss(): string {
  return `
    .footer-capa .handle {
      position: absolute; top: 1210px; left: 0; width: 100%;
      text-align: center; font-size: 18px; font-weight: 300; color: ${TOKENS.branco};
      text-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
    .footer-capa .arrow {
      position: absolute; top: 1208px; right: 118px;
      font-size: 111px; color: ${TOKENS.branco}; line-height: 1;
      text-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
  `;
}

export interface MioloCardOptions {
  bodyHtml: string; // pre-highlighted HTML (with <br/> for paragraph line breaks joined)
  fontSizePx: number; // current auto-fit size
}

export function renderMioloTemplate(opts: MioloCardOptions): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
${baseCss()}
${mioloFooterCss()}
.miolo-bg { background: ${TOKENS.branco}; }
.text-area {
  position: absolute;
  top: 130px; left: 135px; width: 810px; height: 1020px;
  display: flex; align-items: center; justify-content: flex-start;
}
.text-block {
  width: 100%;
  color: ${TOKENS.preto};
  font-weight: 300;
  font-size: ${opts.fontSizePx}px;
  line-height: 1.35;
  text-align: left;
  hyphens: none;
}
.text-block p { margin-bottom: 1.33em; }
.text-block p:last-child { margin-bottom: 0; }
</style>
</head>
<body>
  <div class="card miolo-bg">
    <div class="text-area"><div class="text-block" id="text-block">${opts.bodyHtml}</div></div>
    ${mioloFooter()}
  </div>
</body></html>`;
}

export interface CapaCardOptions {
  headlineHtml: string;
  imageDataUri: string;
  focalPoint: string; // key of FOCAL_POINT_MAP
  variant: "capa" | "cta";
}

export function renderCapaTemplate(opts: CapaCardOptions): string {
  const objectPosition = FOCAL_POINT_MAP[opts.focalPoint] || "center center";
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
${baseCss()}
${capaFooterCss()}
.photo {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: ${objectPosition};
}
.grain {
  position: absolute; inset: 0; width: 100%; height: 100%;
  background-image: url('${GRAIN_DATA_URI}');
  background-repeat: repeat;
  mix-blend-mode: overlay;
  opacity: 0.42;
}
.shadow-band {
  position: absolute; left: 0; width: 100%; height: 600px;
  /* centered on headline block: headline baseline anchor is 1150px from
     top; band is centered around that anchor per spec ("centered on the
     headline block"). DECISION documented in DECISIONS.md. */
  top: 850px; /* 1150 - 300 */
  background: ${SHADOW_GRADIENT};
}
.headline-wrap {
  position: absolute; left: 100px; width: 880px;
  bottom: 200px; /* anchors baseline area at y=1150 from top on a 1350 canvas */
}
.headline {
  color: ${TOKENS.branco};
  font-size: 75px;
  line-height: 1.03;
  letter-spacing: -0.5px;
  font-weight: 300;
}
</style>
</head>
<body>
  <div class="card">
    <img class="photo" src="${opts.imageDataUri}" />
    <div class="grain"></div>
    <div class="shadow-band"></div>
    <div class="headline-wrap"><div class="headline" id="headline">${opts.headlineHtml}</div></div>
    ${capaFooter()}
  </div>
</body></html>`;
}
