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
not the film's irregular, localised splatter, and no faithful port of his
pipeline produces the film's splatter.

So there are two targets, and they are not the same thing. Both are reachable
on `G`:

| mode | seeds from | character |
|---|---|---|
| `deposit` | a disc of ink at each deposit | localised, irregular — closest to the film |
| `whole` | the entire rasterised logogram, as `ca-01.nb` does | self-similar, spreading from the whole circle |
| `procedural` | nothing — no automaton | — |

`deposit` is the default. It uses Wolfram's rules as a *texture source* for
film-shaped bursts, and needs a **reach budget** to stay local: cells outside a
disc around the deposit are forced dry each step. That clipping substitutes for
a property his filter appeared to select for and did not. The clip boundary is
displaced by fbm, sampled into a 512-entry angular lookup — a clean circle
reads instantly as artificial, and it is the one shape ink never has.

`whole` needs no clipping, since the rules are bounded by the frame, but its
step count is a compromise: 700 steps at this grid is ~40ms, a visible stall on
click against a three-second draw. `CA.wholeSteps` is 150, which gives the same
character because these rules reach their visual form early and then churn.

`ca/rules.js` ranks the rules by how filamentary they grow — the fraction of
cells with exactly one ink neighbour, i.e. how many free tips they have. Only
the top of Wolfram's list reads as tendrils; `192184` grows into a near-solid
mass and sits in the pool at a token weight.

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
    growth.js      local growth: reach mask -> run -> trace into ink
    whole.js       faithful growth: rasterise the logogram, run, trace
  ink/
    glyph.js       one logogram as a list of weighted draw ops
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

`?proof` is the fastest way to judge a change to the generator: it shows the
logogram alone on flat ground, the way Wolfram's own figures do. Add
`&unwrap` for the twelve-section strip under each one, and `&mode=whole` to
compare against the faithful port.

`npm run probe:ca` re-runs the rule-selection analysis described above.

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

---

## Licence and attribution

The film imagery and the logogram designs belong to Paramount Pictures / the
*Arrival* production. Wolfram's notebooks are under the terms in that
repository's `COPYING.md`. Everything here is original code.
