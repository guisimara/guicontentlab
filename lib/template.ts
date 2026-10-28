// lib/template.ts
// HTML+CSS string generator for a card (miolo, capa, cta).
// LOCKED layout numbers per spec — do not alter.
import { FONT_FACE_CSS } from "./fonts.generated";
import { MIOLO_BG_DATA_URI, CAPA_MASK_DATA_URI, READ_CAPTION_TAG_DATA_URI } from "./assets.generated";

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;

export const TOKENS = {
  branco: "#FFFFFF",
  preto: "#000000",
  azul: "#0F3250",
};

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
    .azul { color: ${TOKENS.azul}; font-weight: 700; }
    .w600 { font-weight: 600; } /* capa/cta "bold" = Poppins semibold */
    .w300 { font-weight: 300; }
  `;
}

// Footer for miolo cards. Implemented ONCE, used verbatim on every miolo
// card — never re-derived per card.
export function mioloFooter(): string {
  return `
  <div class="footer-miolo">
    <div class="handle">@guisimara</div>
    <div class="vbar"></div>
  </div>`;
}

export function mioloFooterCss(): string {
  return `
    .footer-miolo .handle {
      position: absolute; top: 1227px; left: 0; width: 100%;
      text-align: center; font-size: 28px; font-weight: 700; color: ${TOKENS.azul};
    }
    .footer-miolo .vbar {
      position: absolute; top: 1295px; left: 50%; transform: translateX(-50%);
      width: 4px; height: ${CANVAS_H - 1295}px; background: ${TOKENS.azul};
    }
  `;
}

// Footer for capa/cta cards (different values + text-shadow, no vbar).
export function capaFooter(): string {
  return `
  <div class="footer-capa">
    <div class="handle"><span class="w300">@gui</span><span class="w600">simara</span></div>
  </div>`;
}

export function capaFooterCss(): string {
  return `
    .footer-capa .handle {
      position: absolute; top: 1210px; left: 0; width: 100%;
      text-align: center; font-size: 21px; color: ${TOKENS.branco};
      text-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "Leia a legenda" tag — default is the final baked asset, img/slug-legenda.png
// (270x61), loaded as a data URI via scripts/build-assets.mjs. When a custom
// `tagText` is passed (the "Com tag" text bar, see app/page.tsx), a CSS pill
// matching the same look (gradient + rounded) is rendered instead, so any
// text can be used there — not just the baked-in default string. Positioned
// per spec: the tag's bottom edge sits at 193px from the canvas bottom, and
// the whole tag must stay within the 59px-tall zone between 252px and 193px
// from the bottom. Horizontal placement is not specified by the brief;
// assumed centered within the same 105px side margins used for the headline
// (documented in DECISIONS.md).
export function readCaptionTag(tagText?: string): string {
  if (tagText && tagText.trim()) {
    return `<div class="read-caption-tag"><span class="read-caption-tag-pill">${escapeHtml(tagText.trim())}</span></div>`;
  }
  return `<div class="read-caption-tag"><img class="read-caption-tag-img" src="${READ_CAPTION_TAG_DATA_URI}" /></div>`;
}

export function readCaptionTagCss(): string {
  return `
    .read-caption-tag {
      position: absolute; left: 105px; width: 870px; bottom: 193px; height: 59px;
      display: flex; align-items: center; justify-content: center;
    }
    .read-caption-tag-img {
      height: 59px; width: auto;
    }
    .read-caption-tag-pill {
      display: inline-flex; align-items: center; justify-content: center;
      height: 59px; max-width: 100%; padding: 0 30px; border-radius: 9999px;
      background: linear-gradient(180deg, #91A6BA 0%, #3C5872 45%, #15263B 100%);
      box-shadow: 0 6px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35);
      color: ${TOKENS.branco}; font-weight: 600; font-size: 26px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
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
.miolo-bg {
  background-image: url('${MIOLO_BG_DATA_URI}');
  background-repeat: no-repeat; background-size: cover; background-position: center;
}
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
  showReadCaptionTag?: boolean; // capa only — ignored for cta
  tagText?: string; // custom text for the tag pill; omitted = default "Leia a legenda" asset
}

export function renderCapaTemplate(opts: CapaCardOptions): string {
  const objectPosition = FOCAL_POINT_MAP[opts.focalPoint] || "center center";
  const showTag = opts.variant === "capa" && !!opts.showReadCaptionTag;
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
${baseCss()}
${capaFooterCss()}
${readCaptionTagCss()}
.photo {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: ${objectPosition};
}
.mask {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover;
}
.headline-wrap {
  position: absolute; left: 105px; width: 870px; /* 1080 - 2*105 side margins */
  bottom: 277px; /* lower bound of the 277px-532px-from-bottom headline zone */
}
.headline {
  color: ${TOKENS.branco};
  font-size: ${opts.variant === "cta" ? 50 : 70}px;
  line-height: 1.15;
  letter-spacing: -0.041em; /* "-41" tracking (Adobe/Figma-style units: 1/1000 em) */
  font-weight: 300;
  text-align: center;
}
</style>
</head>
<body>
  <div class="card">
    <img class="photo" src="${opts.imageDataUri}" />
    <img class="mask" src="${CAPA_MASK_DATA_URI}" />
    <div class="headline-wrap"><div class="headline" id="headline">${opts.headlineHtml}</div></div>
    ${showTag ? readCaptionTag(opts.tagText) : ""}
    ${capaFooter()}
  </div>
</body></html>`;
}
