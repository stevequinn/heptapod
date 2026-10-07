# Heptapod — Ink on Glass

A view into an observation window, and the heptapods' logographic script drawn
on the fogged glass in front of you. Click and they answer.

Built on the visual language Christopher Wolfram reverse-engineered for the
2016 film *Arrival*, published in
[Arrival-Movie-Live-Coding](https://github.com/WolframResearch/Arrival-Movie-Live-Coding).

```bash
npm install
npm run dev      # http://0.0.0.0:3000
npm run build
```

---

## What came out of Wolfram's notebooks

The repository is worth reading before you change anything in `ca/`, because
the obvious reading of it is wrong. Most of it is **analysis**, not generation:
Wolfram was working from logogram JPEGs that had been isolated in Photoshop, and
the notebooks measure, cluster, unwrap and compare those images. There is no
generator in there to port.

Three things in it *are* generative or structural, and those are what this app
is built on.

### The twelve-section structure

`sectionBreaking-01.nb` sets `sectionCount = 12` and cuts a logogram into
twelve angular wedges with `CirclePoints`, then rotates each one flat so the
sections can be compared side by side. That decomposition is the vocabulary
`ink/glyph.js` generates from: every logogram gets a **twelve-value ink
profile**, and the stroke weight, the deposits and the gaps are all read off
it. A glyph's identity is a profile around the circle.

An earlier version of this app hand-picked two or three ink pools from a table
of eight compositions. It looked similar and varied far less — with a profile,
the heavy stretches and the calm stretches come out of the seed for free.

The profile needs a contrast curve, and this is easy to get wrong. Summing a
few noise octaves gives roughly 0.35–0.65; normalise that by its mean and clamp,
and every sector lands within 15% of every other — the twelve-section structure
is then doing nothing at all while appearing to. `smoothstep(0.40, 0.62, v)`
expands the useful band back out.

### The cellular automaton

`ca-01.nb` is the actual engine:

```wolfram
CellularAutomaton[{rule, {2, {{2,2,2},{2,1,2},{2,2,2}}, {1,1}}, 0},
                  {ImagePad[Binarize[...], 10, Black], 0}, steps]
```

A two-colour, radius-one, **totalistic** automaton: the next value of a cell
depends only on how many of its eight neighbours are colour 1, and on the
cell's own colour. Eighteen bits of rule number cover all eighteen cases. He
generated random rules and kept thirteen. Those are in `ca/rules.js`.

**The bit layout is not guessable, so it was pinned empirically.** The candidate
is `bit = 9·colour + neighbourCount` (what `ca/rules.js` uses) against
`bit = 9·neighbourCount + colour`. Under the layout actually used, Wolfram's
rules grow, and they span a real range of behaviour from sparse and branchy to
dense. Under the alternative, all thirteen collapse into the same
undifferentiated blob, and 98–100% of random rules do nothing — which would
mean his hand-picked list was arbitrary. The layout is load-bearing.

**The rules are self-sustaining and will flood the frame.** Run unbounded, they
reach 55–70% coverage within ten steps and keep going.

#### The good-rule list is weaker than it looks

I first described those thirteen as Wolfram having curated them for ink-like
growth. They are the survivors of a random search, and his filter is much
weaker than it reads. Reproduced in `tools/probe-ca.mjs` (`npm run probe:ca`):

```wolfram
frames[[-1]] != frames[[-2]]                    &  (* still evolving  *)
Times @@ ImageDimensions[frames[[-1]]] < 80000  &  (* always true     *)
EuclideanDistance @@ BorderDimensions[...] < ...     (* also always true*)
```

- The area term is 14400 on every frame at his settings.
- The bounding-box term *looks* like a containment test, but `@@` threads over
  the 4-list into a **binary** function, so it evaluates as
  `EuclideanDistance[{xmin,xmax},{ymin,ymax}]` — a symmetry test. It reads 3.16
  on the seed ring and 0.00 on every grown frame.

So the filter is in practice just "still evolving at step 700", which accepts
**10 of 13**. Read that third term as it was evidently meant — ink bounding box
must not exceed the logogram's own — and **0 of 13** pass: every surviving rule
fills the padded frame. The three that die early (`174688`, `47808`, `256576`)
are excluded from the picker; `256576` is the identity on a ring and produces
zero new cells, which cost a full automaton run to discover the hard way.

#### Why the splatter here differs from his exports

Wolfram seeds from the **entire binarised logogram** and runs **700 steps**.
The result is self-similar, symmetric growth spreading from the whole circle —
which is what the `.gif`/`.mov` exports in that repository actually show. It is
not the film's irregular, localised growth, and no faithful port of his pipeline
produces the film's growth.

So there are two targets, and they are not the same thing. Both are reachable
on `G`:

| mode | seeds from | character |
|---|---|---|
| `deposit` | a disc of ink at each deposit | one rule per deposit, independent — closest to the film |
| `whole` | the entire rasterised logogram, as `ca-01.nb` does | one rule for the whole glyph, so the deposits are correlated |
| `procedural` | nothing — no automaton | — |

`deposit` is the default and needs a **reach budget** to stay local: cells
outside a disc around the deposit are forced dry each step. That clipping
substitutes for a property his filter appeared to select for and did not. The
clip boundary is displaced by fbm, sampled into a 512-entry angular lookup — a
clean circle reads instantly as artificial, and it is the one shape ink never
has. `growth.js` asserts the patch is large enough for `reach` plus a margin,
because a patch that is too small clips growth square and the clipping reads as
a fault in the brush rather than as a misconfiguration.

`whole` needs no clipping, since the rules are bounded by the frame, but its
step count is a compromise: 700 steps at this grid is ~40ms, a visible stall on
click against a three-second draw. `CA.wholeSteps` is 150, which gives the same
character because these rules reach their visual form early and then churn. Its
seed is the *plain* glyph — a thin ring and a disc at each deposit — not the
finished one, which would only redraw the ring in a different texture.

`ca/rules.js` ranks the rules by how filamentary they grow — the fraction of
cells with exactly one ink neighbour, i.e. how many free tips they have. Only
the top of Wolfram's list reads as tendrils; `192184` grows into a near-solid
mass and sits in the pool at a token weight.

The rule weights are **square-rooted, not linear**. Weighting by rank directly
put half of all glyphs on a single rule, which was defensible while the
automaton supplied the logogram's geometry — its structure was the whole look.
It is not defensible now that the automaton supplies a measurement and some
bristles: the rule is one source of variety among several, and drawing half the
seeds from one of eleven rules throws that away.

### What the automaton is actually for

Worth stating plainly, because it changed twice and the reason is not obvious.

A cellular automaton is a grid. Ink is not. Tracing growth into geometry — one
hair per surviving cell — produces a radial isotropic spray, which is the
grammar of spatter, and none of the reference logograms look like that. It was
tried, it read as spatter stuck to a thin wire, and it was wrong.

So the automaton now does **two measurements, no geometry**:

- **width** — how deep is the ink at each angle around a deposit? That becomes
  the stroke's half-width. A grid is a poor way to draw ink and a perfectly good
  way to measure it.
- **texture** — the same run's fringe cells emit the fine bristles a loaded
  brush leaves as it lifts off a wet mass.

Both come from one run, so the rule influences shape and surface together. This
is also what self-similar growth is *for*: a rough starburst of hairs leaving a
mass is precisely what radial CA growth looks like when you use it as texture.

The three quantities that control this are deliberately separate, and conflating
them is what produced the earlier glumps:

| | | |
|---|---|---|
| `CA.reach` | the growth *envelope* | 0.30 ring radii — has to reach well past the stroke, or the bristles have nowhere to go |
| `BRUSH.bladeReach` | how much envelope counts as *weight* | 0.19 — below `reach` on purpose, so a growth that barely grew gets a thin blade |
| `GLYPH.stroke` × `BRUSH.swellMax` | the stroke's own peak | the hairline, and a multiple of it |

### The polar unwrap

`unwrapping-01.nb` takes a logogram to `{ArcTan@@#, Norm@#}` — angle across,
radius up — and lays it out as a strip. Press **U**.

Doing that as an image transform resamples the ink and turns a scratchy pen
line into mush, so `unwrap/warp.js` intercepts the canvas path-construction
calls and maps the coordinates as they are drawn. Every stroke stays exactly
as crisp as it was in the round view.

### What was *not* portable

`arrivalLiveCoding.nb` is `FeatureExtraction`, `LatentSemanticAnalysis`
clustering and nearest-neighbour lookup over `ImageDifference`. It measures
similarity between logograms. Interesting, and the hook for a "find me a glyph
like that one" feature, but it is analysis of images and has no bearing on
what a logogram looks like.

### Why Three.js, and not WebAssembly

The glyphs are ink on a fogged pane: thousands of small translucent strokes
composited in 2D. Three.js is valuable here for its WebGL2 pipeline, not its
scene graph — the scene graph in this repo exists only to place two heptapod
billboards in a perspective camera. A WASM rewrite would still have to call
into WebGL for the compositing, so it would be a worse renderer written by
hand.

The one place WASM could pay is the automaton, and it does not need to: a
112² patch for 34 steps is about 400k cell updates, and the whole glyph builds
in **8ms** against a three-second draw. See *Performance* below for what was
actually slow instead.

---

## Layout

Vanilla ES modules. No framework: this is a canvas app with a 60fps render loop
and about six readouts of state, and a reconciler between you and the render
loop would be pure cost. Plain modules plus one quantised cache key.

```
src/
  config.js        every tunable, in one place
  main.js          the clock, the pointer, and the decision to write a glyph
  lib/
    math.js        seeded PRNG, value noise, easing
    glsl.js        shared GLSL noise
  ca/
    rules.js       Wolfram's rules, what survives his filter, and why
    automaton.js   the totalistic stepper
    growth.js      growth -> two measurements: ink depth per angle, and bristles
    whole.js       the whole-glyph run, seeded from the rasterised logogram
  ink/
    glyph.js       one logogram as a list of weighted draw ops
    brush.js       the stroke: width profile, band, striation, bristles, spurs
    smoke.js       the interior ink haze
    writer.js      the ink buffer, and the life of each inscription
  unwrap/
    warp.js        a canvas proxy that maps polar coordinates as they are drawn
    panel.js       the twelve-section view
    proof.js       the bare-glyph contact sheet
  scene/
    stage.js       renderer, targets, pass order
    fog.js         the volume behind the glass
    pods.js        heptapod silhouettes
    glass.js       glass composite, bloom, grade
  ui/
    chrome.js      reticle, hint text, boot veil
    input.js       pointer easing, keys, query flags
```

A glyph is a list of weighted `ops` drawn progressively, so the ink appears to
be laid down by a limb rather than appearing whole. `ops` are plain closures
over a 2D context, which is what lets the unwrap view reuse them unchanged
through a warping proxy.

**The order in `makeRingGlyph` matters.** The automaton runs *before* the band
is built, because the band *is* the stroke and the stroke's weight is what the
automaton measured. An earlier version drew the ring first and laid the
deposits on afterwards, which is what forced a separate band and with it the
glump-on-a-wire look.

**`tools/reference/compare.html`** is the other file worth knowing about. It is
a dev tool, served by `npm run dev`, not a build entry.

---

## Keys

| | |
|---|---|
| click / tap | ask for a glyph where you clicked |
| `Space` | ask again, at the cursor |
| `U` | unwrap into twelve sections |
| `G` | cycle the growth mode: deposit → whole → procedural |
| `C` | clear the pane |
| `H` | hide the chrome |

## Query flags

For screenshots and tests. Glyphs are fully determined by their seed, so
`?warm=` reproduces a frame exactly.

| | |
|---|---|
| `?warm=9` | fast-forward nine seconds at a fixed timestep, paint once |
| `?at=x,y` | place the cursor |
| `?click` | request a glyph at the cursor |
| `?mode=deposit\|whole\|procedural` | how the ink deposits are grown |
| `?unwrap` | start in the twelve-section view |
| `?proof=18` | contact sheet of bare logograms, no scene, fog or grade |
| `?debug` | frame timing, mark progress, ink coverage, the rule in use |

`?proof` shows the generator alone on flat ground. For judging likeness, use
the comparison tool instead — see below.

`npm run probe:ca` re-runs the rule-selection analysis described above.

## Judging the glyphs

The scene tells you how a glyph sits in the film. It does not tell you whether
it *looks* like a logogram, and the fog, the glass and the grade are actively
misleading about that — they soften everything, so a wrong stroke weight still
reads as atmospheric.

So there is a second tool, and it is the one to actually work against:

```bash
npm run reference       # fetch the 38 real logogram frames
npm run dev             # then open:
# http://localhost:3000/tools/reference/compare.html
```

A real logogram frame above, the generator's output for the seed below, paired
in the same column at the same size. Query params for seeds, mode, cell size and
which frames to use; the controls write themselves back to the URL, so a frame
you are happy with can be reproduced exactly.

**Ink only** (`?bare=1`) drops the dry-pass ops — interior haze, ghost
scratches, dry texture. The reference frames are cutouts of ink on white with
none of that on them, so leaving it in makes the comparison unfair; but it is
part of the glyph in the scene, so both views are worth having.

Those frames come from `ScriptLogoJpegs` in Wolfram's repository — the 3300px
originals the logograms were lifted from. They are not committed here: they are
film assets and they are large. `npm run reference` fetches them into a
gitignored directory.

The low-resolution "HEPTAPOD LOGOGRAMS WITH TRANSLATION" sheet that circulates
online is *not* good enough to work from. Working from it produced three
wrong conclusions, each of which cost a rewrite:

- **stroke weight** — the real ring is several times heavier than it appears
  there, and it swells into a blade rather than staying a line. On a 75px-radius
  ring the hairline is ~3.5px and the heaviest regions run 25–32px, so 7–9×.
- **whether the heavy part belongs to the ring or sits beside it** — it belongs
  to it. One continuous stroke. Drawing a thin ring and then laying a filled
  band on top of it reads as a glump stuck to a wire; that was an architectural
  error, not a parametric one, and no amount of tuning the band fixed it.
- **what grows off the fat regions** — not one thing but two, and they were
  conflated. Short heavy wedges with width, tapering to sharp points. *And* a
  starburst of fine bristles, which is what the automaton is actually good at.
  An earlier version had only the first and called the second "spatter".
- **surface** — real ink over its own footprint is striated, with thin gaps
  running along the stroke where bristles did not touch. A uniformly filled
  band reads instantly as vector. This is `BRUSH.strips`, and the curve in
  `striations()` matters more than the noise: remapped linearly, a mean-0.5
  noise gives a mean alpha near 0.4 and the whole ring turns into a faded
  photocopy.

---

## Performance

Measured in the desktop browser at 1056×2236, one tab. Two things were slow,
and neither was where it looked:

**Glyph build: 33ms → 8.4ms.** The automaton was never the problem — it is
about 5ms of that. The rest was the interior ink haze: a 224² tile evaluated
with thirteen octaves of noise per pixel, then drawn at roughly three times its
own size and linearly filtered the whole way. There is nothing in a diffuse
wash for detail to survive in, so the tile dropped to 96².

**Unwrap view: 31fps → 61fps.** Its own draw call cost 0ms. The cost was
`mix-blend-mode: multiply` on a full-viewport overlay, which forces the
compositor to read back the WebGL layer and blend it into the stacking context
on every frame, whatever the overlay contains. Multiply looks marginally richer
because it darkens in proportion to what is behind — but over black ink,
ordinary alpha compositing darkens the same pixels by the same rule.

Also worth knowing: the automaton's grid becomes visible in the ink above
about 0.03 ring-radii per cell. `CA.cell` is 0.012, which puts ~80 cells per
ring radius.

Measured build cost per glyph, median of seven:

| mode | build |
|---|---|
| `deposit` | ~8ms |
| `procedural` | ~6ms |
| `whole` | ~20ms |

`whole` is the automaton running 150 steps over the whole rasterised glyph, and
it is the reason that mode is not the default.

### Cost of the striation

Drawing the band as eight longitudinal strips instead of one filled polygon
multiplies the fill count by eight — 54 chunks × 8 = 432 fills per glyph, where
there used to be 54. It measured as roughly 1ms of the 8ms, which is the right
trade for the difference between ink and a vector shape. `BRUSH.strips` is the
knob: eight reads as a brush, three as a comb, one as a solid polygon again.

---

## Licence and attribution

The film imagery and the logogram designs belong to Paramount Pictures / the
*Arrival* production. Wolfram's notebooks are under the terms in that
repository's `COPYING.md`. Everything here is original code.
