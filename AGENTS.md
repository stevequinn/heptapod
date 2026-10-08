# AGENTS.md

Notes for agents and humans working on this repository. The README is the
short tour; this file is the working agreement.

Heptapod is a vanilla-ES-modules Vite app that renders *Arrival*-style
logograms as ink condensing on a fogged pane. Three.js is the WebGL pipeline
only. No framework, no build step beyond Vite.

## Commands

| | |
|---|---|
| `npm run dev` | app + tools on `http://localhost:3000` (host `0.0.0.0`, `strictPort`) |
| `npm run build` | bundle to `dist/`; run it before every commit |
| `npm run preview` | serve `dist/` on the LAN (also port 3000 — one server at a time) |
| `npm run deploy` / `npm run preview:cf` | Cloudflare Pages via wrangler |
| `npm run reference` | fetch the 38 reference frames into a gitignored directory |
| `npm run probe:ca` | re-run the automaton rule-selection analysis |

Dev tools: `/compare` (style calibration — `tools/reference/compare.html`, a
second build entry, rewritten to that URL in dev and preview and by
`public/_redirects` on Pages), `tools/probe-ink.html` (measurement),
`?proof=N` (bare contact sheet), `?warm=N` (deterministic fast-forward).
See the README.

## Invariants

Read these before changing a generator or the scene. Each one was learned the
hard way, and the commit history has the long version.

**Circles are circles.** `GLYPH.eccentricity` is off on purpose — even a few
percent of ellipticity reads as an oblong glyph, not a hand-drawn one. The
radial wobble is what keeps it alive. Filaments leave a blot by its *local
weight*, taper, and end in a small round knob (`tipBulb`), never a point.

**Everything heavy is deposition.** A blot is a placement field; rings,
arcs and strokes accumulate into it. Never replace this with a filled polygon
or a shaped arc — that is the "glump stuck to a wire" failure the process
exists to avoid. Order in `makeRingGlyph` is: blots, the circle that carries
them, then what leaves them.

**The writer does not draw.** An inscription is rendered once to a snapshot and
revealed through a threshold field (materialise), then that field is run
backwards (dissolve). No stroke-order playback, no travelling limb, no cloud
on the way out — smoke belongs to arrival only.

**No procedural noise in fragment shaders.** Phone GPUs run fragment floats at
mediump; the old sin-hash fbm quantised into faint diagonal banding on mobile
only. Everything smooth comes from the baked sheet in `scene/noise-tex.js`
(R/G/B fbm fields, A white noise). Do not reintroduce `hash12`/`fbm` into
scene shaders; sample the texture.

**Ripples stay local.** The request ripple's radius is capped to the short side
of the pane (`rMax` in `fog.js` and `glass.js`); an expanding ring larger than
that reads as a stray diagonal line across the screen, not as water.

**The opening beat.** The first inscription is written by `step` at
`app.openingAt` (3 s), not at construction, so the window opens empty; any
request — tap, key, ask, clear, the idle scene — cancels it. `?warm=` writes
it immediately so warmed frames stay fixed compositions.

**Sound etiquette.** First playback waits `SOUND.delay` (3 s) after the first
gesture; the tone pauses on `visibilitychange` hidden (minimised, locked) and
resumes when visible; the preference lives in `localStorage`
(`heptapod.sound`, with a read-fallback to the old `arrival.sound`). Sound
must only ever be started from a user gesture or the deliberate post-gesture
delay.

**Mobile footer.** On coarse pointers the footer is one compact bottom line:
hint left, Clear and Sound right, no key badges, no Ask/Hide buttons. Unwrap
is keyboard-only by design. Keep `(pointer: coarse)` and the `max-width: 620px`
mirror in step.

**Determinism.** A glyph is a pure function of its seed; `?warm=` and
`?proof=` reproduce frames byte-for-byte. Keep `rng` draw *order* stable when
editing a generator, and keep the warm path free of wall-clock time.

## Calibration loop

`config.js` `STYLE` ↔ compare-page sliders. Eyeball on `refs` (all 38 frames
together, not one at a time), verify with `tools/probe-ink.html` (reference
*ranges*, not deltas), then write the numbers back into `STYLE`. Do not change
`STYLE` defaults without working through that loop — the defaults are
calibrated, and the review page overrides them via URL params.

Paired reading worth keeping in mind: the ring is a thin near-constant circle
and the heavy regions sit *on* it; filaments leave heavy regions and never the
quiet ring. Those two sentences catch most regressions by eye.

## Working in this environment

- The desktop is not visible and the WebGL canvas is not capturable
  (`preserveDrawingBuffer: false`). Verify by driving the page and reading
  state:
  - `window.heptapod` exposes `{ app, ink, stage, unwrap, sound,
    requestGlyph, THREE, makeRingGlyph }`.
  - To see rendered pixels, run the pass chain manually into a
    `WebGLRenderTarget` and `renderer.readRenderTargetPixels` (the pattern is
    in this file's history and easy to re-write from `stage.render`).
  - `ink.canvas` can be sampled directly for ink-buffer frames.
- After shader edits, check `renderer.info.programs` for `diagnostics` and
  `#fatal` for runtime errors, and re-run `npm run build`.
- 2D-canvas mock strips are the cheapest way to evaluate ink/smoke candidates
  before touching the real modules.

## Style and conventions

- Comments explain *why*, in full sentences; the `═══` banner headers set the
  scene for a module. Match the surrounding voice.
- Every tunable goes in `config.js`; modules carry mechanism, not magic
  numbers.
- One concern per module; keep `main.js` about the clock, the pointer and
  deciding to write a glyph.
- UI text is sentence case in markup (CSS uppercases it) and stays legible on
  touch.

## Repo hygiene

- Do not commit user media or scratch files (`ink.png`, `diagnal-line.*`),
  fetched reference frames (`tools/reference/logograms/`), or `dist/`.
- Keep the README succinct and current; longer rationale belongs in commit
  messages or here.
- `index.bak.html` and the older tracked screenshots (`screenshot*.png`,
  `ring_*.png`, `pod_ring.png`) are pre-history leftovers; leave them unless
  the owner asks.
- Commit only the files a change touches; if the worktree already holds
  unrelated edits (owner's deployment work, captures), leave them out of the
  commit.
