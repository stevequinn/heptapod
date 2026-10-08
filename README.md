# Heptapod — Ink on Glass

A view into an observation window: fogged glass, two drifting heptapods, and
their logographic script. Click and they answer — an inscription condenses out
of ink in water, holds, and later dissolves back the way it came.

The visual language is the heptapod logograms from the film *Arrival* and the
twelve-section decomposition Christopher Wolfram used to analyse them in
[Arrival-Movie-Live-Coding](https://github.com/WolframResearch/Arrival-Movie-Live-Coding).
Everything here is original code; the film imagery and the logogram designs
belong to Paramount / the film's production.

## Running it

```bash
npm install
npm run dev       # app + dev tools on http://localhost:3000
npm run build     # bundle to dist/
npm run preview   # serve dist/ on :3000, reachable from the LAN
```

`dev` and `preview` both want port 3000, so run one at a time.

## Controls

| input | |
|---|---|
| click / tap | ask for a glyph there |
| `Space` | ask again, at the cursor |
| `U` | unwrap into twelve sections (keyboard only) |
| `C` | clear the pane |
| `H` | hide the chrome |
| `M` | sound on/off |

The window opens empty: the first inscription arrives after a beat, unless you
ask for one first. On touch devices the footer is one compact line — hint on
the left, Clear and Sound on the right — and the scene itself is the Ask
button. The room tone starts three seconds after the first interaction, loops,
pauses while the page is hidden or the phone is locked, resumes when it
returns, and remembers its on/off choice.

## What a logogram is

A thin circle of near-constant weight; one to three dense blots of ink sitting
on it; filaments that leave the blots, taper and end in a small round knob; and
almost nothing inside. Glyphs are fully determined by their seed.

The generator (`src/ink/`) is a layered ink process. A twelve-value ink profile
drives the ring's weight around the circle. A blot is a *placement field* that
hundreds of overlapping strokes, deposits and flecks accumulate into — never a
filled polygon. Everything heavy is deposition; the blob is what falls out of
it. The tunables live in `config.js` as the `STYLE` block.

An inscription's life is **materialise → hold → dissolve**. The glyph is
rendered once to a snapshot and revealed through a threshold field built from
its ignition points, with a smoke cloud — turned, stretched crops of a shared
ink-in-water sheet — billowing underneath. The dissolve runs that field
backwards and without the cloud: the ink that condensed last leaves first, the
wave travelling back toward the ignition points.

## Calibrating the style

`STYLE` in `src/config.js` — `clusterCount`, `clusterDensity`,
`filamentDensity`, `filamentLengthVariance`, `ringWobble`, `inkRoughness`,
`microSplatter` — is what the review page drives directly:

```bash
npm run reference        # fetch the 38 reference frames (film assets, not committed)
npm run dev
# http://localhost:3000/tools/reference/compare.html
```

`refs` (all 38 frames at once) is the view to judge against; `interleave` mixes
them with generated glyphs; `threshold` applies the same hard cut the reference
frames have. `tools/probe-ink.html` measures sixty generated glyphs the way the
references were measured and flags anything outside their range — the review
page is for shape, the probe is for scale. A style found by eye is written back
into `STYLE`.

## Query flags

For screenshots and tests; glyphs are reproducible from their seed.

| | |
|---|---|
| `?warm=9` | fast-forward nine seconds at a fixed timestep, paint once |
| `?at=x,y` | place the cursor |
| `?click` | request a glyph at the cursor |
| `?unwrap` | start in the twelve-section view |
| `?proof=18` | contact sheet of bare logograms, no scene, fog or grade |
| `?seed=N` | override the opening glyph's seed |
| `?debug` | frame timing, mark progress, ink coverage, blot and filament counts |

## Layout

```
src/
  config.js      every tunable, in one place
  main.js        the clock, the pointer, the opening beat, glyph requests
  ink/           glyph.js (a logogram as weighted draw ops), blot.js,
                 stroke.js (the circle and its band), offshoots.js
                 (filaments, clubbed tips, spatter), smoke.js, writer.js
                 (the pane, and the life of each inscription)
  scene/         stage.js (targets and pass order), noise-tex.js (the baked
                 noise sheet), fog.js, glass.js (composite, bloom, grade),
                 pods.js (heptapod silhouettes)
  unwrap/        warp.js (a polar canvas proxy), panel.js (the twelve-section
                 view), proof.js (bare-glyph contact sheet)
  ca/            Wolfram's automaton — kept as an experiment, not in the
                 render path
  ui/            chrome.js, input.js, sound.js
tools/
  reference/compare.html   the calibration surface
  probe-ink.html           measurement against the reference ranges
  probe-ca.mjs             re-runs the rule-selection analysis
```

Three.js is used for the WebGL pipeline, not the scene graph — the graph exists
only to place the two heptapod billboards. The scene is four targets and five
passes: fog at half resolution, the glass composite, a quarter-resolution
bloom, and the final grade with grain. The scene's noise is a *baked texture*
(`scene/noise-tex.js`), never a shader fbm: phone GPUs run fragment floats at
mediump, where a sin-hash quantises into visible diagonal banding.

## Deployment

Hosted on Cloudflare Pages as a static site: `dist/` is served directly, with
no Worker in front of it. `wrangler.toml` marks the Pages project and
`public/_headers` + `public/_redirects` ship with the build.

```bash
npx wrangler login       # once, to authenticate this machine
npm run deploy           # build, then upload dist/ to the `heptapod` project
npm run preview:cf       # serve dist/ through wrangler exactly as Pages will
```

The custom domain is an account-level binding rather than committed config:

```bash
npx wrangler pages domain add heptapod.dotdoing.com --project-name heptapod
```

## Attribution

The film imagery and the logogram designs belong to Paramount Pictures / the
*Arrival* production. Wolfram's notebooks are under the terms in that
repository's `COPYING.md`. Everything here is original code.

Working on the code itself? See [AGENTS.md](AGENTS.md).
