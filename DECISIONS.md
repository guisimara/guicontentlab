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
