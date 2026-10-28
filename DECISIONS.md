# Decisions log

Every place the spec was ambiguous, and the literal-reading decision taken.

1. **Emoji stripping regex.** The spec says "strip emojis" but doesn't
   specify the exact Unicode ranges. Used a broad-but-practical set (misc
   symbols/pictographs, dingbats, regional indicators, arrows, and the
   variation-selector/ZWJ marks used to build compound emoji) rather than the
   full Unicode emoji-sequence database. Each removed match is counted;
   reported per card as `emojisRemoved`.

2. **Double-blank-line paragraph split.** Implemented as "two or more
   consecutive newlines" (`\n{2,}`) after normalizing `\r\n`, which is the
   literal effect of a blank line between paragraphs in a text file.

3. **Shadow band vertical anchor.** Spec says: "Anchored centered on the
   headline block (so it sits vertically centered around where the headline
   block is, sized 600px tall)". Since the headline's baseline anchor is
   locked at y=1150px from the top, the band is placed at `top: 850px`
   (`1150 - 300`), i.e. centered on the y=1150 anchor line, height 600px.
   This is the most literal reading of "centered on the headline block"
   given the only fixed number available (the 1150px anchor).

4. **Headline baseline anchor implementation.** The spec requires the
   headline's baseline sit at y=1150 (200px from the bottom, on a 1350px
   canvas), and says to "verify by computing the rendered bounding box in a
   self-check, not just trusting CSS math." Implemented via
   `position: absolute; bottom: 200px` on a wrapping div (`.headline-wrap`),
   which pins the wrapper's bottom edge to y=1150. This is an approximation
   of "baseline anchor" using the box's bottom edge, since CSS has no native
   way to anchor by true glyph baseline for a wrapping absolutely-positioned
   block without a fixed known line count. Multi-line headlines will have
   their block's bottom (not last line's baseline) at y=1150 — documented
   here as the literal-reading trade-off. QA check `headline-break` is
   best-effort per spec and does not perform actual glyph baseline
   measurement.

5. **Grain texture determinism.** Implemented as an inline SVG
   `feTurbulence` filter with fixed `seed="7"`, `baseFrequency="0.9"`,
   `numOctaves="2"`, tiled as a repeating 300x300 background image, so every
   render of every job produces byte-for-byte the same noise pattern. Exact
   numeric values for seed/frequency/octaves are not specified by the brief,
   so reasonable fixed values were chosen and locked (never randomized).

6. **Widow/orphan `&nbsp;` heuristic.** The spec's check ("last line has a
   single word") requires knowing rendered line-wrapping, which is only
   observable in the browser, not from the HTML string. Given the highlight
   HTML is already built with `<b>` tags, the implementation applies the
   `&nbsp;`-join heuristic to the last plain-text space in each paragraph's
   HTML (joining what would typically be the paragraph's final two words)
   opportunistically, then re-measures; if the result still fits, it's kept
   and counted as a widow correction, otherwise the font size is backed off
   one step per spec. This is an approximation — a fully precise
   implementation would need to read `Range.getClientRects()` per rendered
   line inside Puppeteer and this was deemed reasonable for the scope here.

7. **Card splitting heuristic.** "Split at the paragraph boundary closest
   to the vertical midpoint of the rendered content" is implemented as
   splitting at the paragraph-count midpoint (i.e. by number of paragraph
   units, not literal measured pixel midpoint of rendered content), since
   each paragraph is already treated as an atomic, non-subdivisible unit
   (numbered lists / bible reference+quote blocks are always constructed as
   single paragraphs upstream in the parser, so they're never split
   mid-block). For content with paragraphs of very unequal length this is
   an approximation of the true visual midpoint; documented as a reasonable
   trade-off given atomic units must stay whole.

8. **Bible reference own-line requirement.** The spec says the reference
   "should be on its own line" but doesn't mandate the parser reformat text
   the user already wrote — per the "never rewrite the user's text" hard
   rule, the highlight engine detects and highlights the reference wherever
   it appears in the given text, but does not forcibly insert a line break
   if the user didn't put it on its own line. If already on its own line (as
   in normal usage), the highlighting looks exactly as specified.

9. **Auto-selected minimum-2-highlights word choice.** Spec says "pick the
   highest-semantic-weight remaining words ... never highlight
   articles/prepositions/conjunctions." Implemented as: skip the shared
   linking-words list, skip words shorter than 4 characters, and pick the
   first remaining content words in reading order until the 2-highlight
   minimum is reached. This is a simple heuristic, not a real semantic/NLP
   ranking; every auto-selected word is reported in `report.json` under
   `highlights` with `type: "auto-selected"` for human review, as required.

10. **Manual `**word**` markup disabling automatic rules "for that entire
    card"** (miolo) vs **"for that specific piece"** (capa/cta). Implemented
    literally: for miolo, if any `**...**` appears anywhere in the card's
    raw text, the whole card uses only the manual markup (all fixed-list /
    numbered-line / bible-ref / auto-selection rules are skipped for that
    card). For capa/cta, the override is scoped to the single headline
    text piece being rendered (there is only one text piece per capa/cta
    card in this implementation, so in practice this is equivalent, but the
    function signature keeps the distinction explicit for clarity).

11. **Focal point on the fixed 9-position grid.** Mapped directly to CSS
    `object-position` keyword pairs (e.g. `top-left` → `left top`,
    `center` → `center center`), the most literal way to express a 9-cell
    grid selection as `object-fit: cover` cropping.

12. **Puppeteer font-check timing.** `document.fonts.ready` alone does not
    force a `@font-face` to load if nothing on the page has yet used that
    exact family/weight/style combination (confirmed while building this
    app — `document.fonts.check()` returned `false` even after `ready`
    resolved, because Chromium hadn't been asked to load the face yet). The
    implementation explicitly calls `document.fonts.load('300 49px
    Poppins')` and `document.fonts.load('700 49px Poppins')` before
    `document.fonts.ready`/`.check()`, on every card and on the initial job
    font probe, so the check is a true "did the embedded font actually load"
    signal rather than a false negative.

13. **Development-machine Puppeteer/Chromium install issue (environment
    note, not a spec decision).** In this environment `puppeteer`'s
    automatic Chromium download initially unpacked an incomplete `.app`
    bundle (missing `Contents/Resources`, `Contents/Frameworks`, unsigned
    stub binary), causing `spawn Unknown system error -88`. Fixed by
    re-extracting the already-downloaded zip
    (`~/.cache/puppeteer/chrome/.../*.zip`) in full and clearing the macOS
    quarantine flag (`xattr -dr com.apple.quarantine`) on the unsigned
    Chrome-for-Testing binary. Documented in SETUP.md as a troubleshooting
    step in case it recurs on a fresh machine.

14. **Capa/CTA "text piece" scope for highlight.** Capa and CTA headlines
    are single short phrases per the sample format (`[CAPA]` / `[CTA]`
    blocks are single paragraphs in the intended usage); if a user supplies
    multiple paragraphs under `[CAPA]`/`[CTA]`, they are joined with a
    single space into one headline string before highlighting, since the
    spec's capa/cta layout has one headline block, not multiple paragraphs.

---

## @guisimara rebrand (Content Lab)

Decisions taken while adapting the Letícia Fessel tool into "CONTENT LAB |
Gui Simara" for @guisimara, keeping the exact same logic/engine and only
changing colors, names, copy and the two format options below.

15. **Blue brand color value.** The spec said "altere para azul" without a
    hex code. Sampled the fully-opaque region of the user-provided mask
    asset (`img/teste1.png`, bottom of the canvas) and used that exact
    value, `#0F3250`, as `TOKENS.azul` (replacing `TOKENS.vinho`), so the
    miolo highlight/footer color visually matches the capa mask asset.
    Confirmed with the user before implementing.

16. **Miolo/capa background watermark vs. dynamic footer — patched out, not
    left as-is.** Both `img/miolo.png` and `img/teste1.png` contain a faint
    reference "@guisimara" watermark baked in at y≈1232-1254 (bbox
    pixel-sampled, x≈475-605), close to but not pixel-identical to where the
    dynamic CSS footer handle renders (`top: 1227px` miolo / `top: 1210px`
    capa). Initially assumed this was harmless since the positions roughly
    coincide, but rendering a test card showed the two actually visibly
    double-expose/stack into garbled text (different font/size/weight than
    the live Poppins footer). Fixed in `lib/assets.ts`: before embedding
    either asset as a data URI, a clean 1080×35px strip is cloned from each
    asset's own flat background (y=1180-1215, sampled to confirm near-zero
    variance there) and composited over the y=1225-1260 watermark region,
    so only the dynamic footer text shows. The source files in `img/` are
    left untouched — the patch is applied in-memory at load time.

17. **Capa/CTA mask compositing — plain overlay, no CSS blend mode.** The
    old `.grain` (SVG feTurbulence) + `.shadow-band` (CSS gradient) layers
    are replaced by a single `<img class="mask">` using the user-provided
    `img/teste1.png` (tested asset; the user said the final PNG model may
    still change — only the file needs swapping, the `<img class="mask">`
    wrapper stays the same). Pixel-sampled the asset's alpha channel: it
    fades from near-transparent (alpha ~48) at the top grain area to fully
    opaque (alpha 255) navy by ~y=1000, already baking in the
    grain-to-shadow-to-solid effect. Composited as a normal (non-blended)
    absolutely-positioned image on top of the user's photo — no
    `mix-blend-mode`/opacity needed since the asset's own alpha does the
    work, unlike the old procedural grain layer which needed
    `mix-blend-mode: overlay`.

18. **Headline box: range spec, not a single anchor.** Old spec gave one
    fixed anchor (baseline at y=1150). New spec gives a range: headline
    must sit "entre 532px e 277px de baixo para cima", i.e. between
    `top: 818px` (1350-532) and `top: 1073px` (1350-277) measured from the
    canvas top — a 255px-tall zone. Per the project's existing convention
    (decision #4: anchor via the wrapping div's bottom edge, not true glyph
    baseline), implemented as `bottom: 277px` (pinning the box to the lower
    bound of the zone) with no enforced `max-height`/clipping at the
    255px mark — consistent with the original implementation's choice to
    not hard-clip overflowing headlines. Side margins set to the explicitly
    given `105px` each side (`left: 105px; width: 870px`), replacing the
    old `100px`/`880px` values.

19. **"Leia a legenda" tag — final asset swapped in.** Initially
    implemented as a text pill placeholder, then replaced with the user's
    final asset `img/slug-legenda.png` (270×61) once provided. Loaded as a
    base64 data URI via `scripts/build-assets.mjs` (`READ_CAPTION_TAG_DATA_URI`
    in `lib/assets.generated.ts`) and rendered as an `<img>` in
    `readCaptionTag()` (`lib/template.ts`), scaled to `height: 59px` /
    `width: auto` to fit the given zone (`bottom: 193px`, 59px-tall zone up
    to 252px from the bottom), toggled per-job via `showReadCaptionTag`
    (capa only, never on cta). Horizontal placement/width is not specified
    by the brief — kept centered within the same `105px` side margins used
    for the headline, for visual consistency. Verified visually via a
    real-browser render (lightbox full-size view): tag sits centered below
    the headline, above the `@guisimara` footer, no clipping/distortion.

20. **"Estático" format scope.** Confirmed with the user: "Estático"
    renders only the capa card (1 PNG, `01-capa.png`), skipping miolo and
    CTA entirely — no CTA image upload is required/used, and parser
    warnings about missing miolo/CTA cards are suppressed in this mode
    since they're intentionally not rendered. "Carrossel" keeps the
    original full behavior (capa + miolo(s) + CTA) unchanged.

21. **QA "fundo do miolo" check adapted from literal #FFFFFF to the brand
    asset's own sampled pixel.** The original check hard-coded
    `rgb(255,255,255)` per the old white-background spec. Since the miolo
    background is now `img/miolo.png` (textured, not flat white), the
    check now samples the same reference pixel from the source asset file
    itself and compares every rendered miolo card's pixel against that
    reference — preserving the original check's real invariant ("background
    identical across every card in the job") without hard-coding a stale
    literal.
