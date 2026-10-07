# Heptapod — Ink on Glass

A view into an observation window, and the heptapods' logographic script drawn
on the fogged glass in front of you. Click and they answer.

Built on the visual language of the heptapod logograms from the 2016 film
*Arrival*, and on the twelve-section decomposition Christopher Wolfram used to
analyse them in
[Arrival-Movie-Live-Coding](https://github.com/WolframResearch/Arrival-Movie-Live-Coding).
The cellular automaton in that repository is also here, but as an experiment
rather than as the generator — the reasoning is in
[What came out of Wolfram's notebooks](#what-came-out-of-wolframs-notebooks).

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

One thing in it is genuinely structural and is what this app generates from —
the twelve-section decomposition. The other generative-looking thing, the
cellular automaton, turns out to be an experiment performed *on* the logograms
rather than a model of them, and it is not in the render path. That distinction
cost three rewrites to establish; see below.

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

### The cellular automaton — kept, but not in the render path

`ca-01.nb` runs a two-colour, radius-one, **totalistic** automaton over a
binarised logogram: the next value of a cell depends only on how many of its
eight neighbours are ink, and on the cell's own value. Eighteen bits of rule
number cover all eighteen cases, and Wolfram generated random rules and kept
thirteen. Those are in `ca/rules.js` and the stepper is `ca/automaton.js`.

It is a genuinely interesting piece of code and it was, for a long time, the
centre of this project. **It is not used to draw anything any more**, and the
reason is worth stating carefully because the pull toward it is strong.

#### The reference figures are the *input* to that notebook

The obvious reading of the repository is that `ScriptLogoJpegs` are examples of
what the CA produces. The opposite is true, and the code says so:

```wolfram
i2 = SetAlphaChannel[#, ColorNegate@#]& /@ (ImageResize[#, 50]&) /@
     Import /@ (logogramDirectory<>#&) /@
     Select[StringMatchQ[#, ___~~".jpg"]&] @ Import@logogramDirectory
```

`ca-01.nb` **imports the JPEG folder** and feeds each image to
`CellularAutomaton` as the initial condition. The chain runs
*logograms → automaton*, not the other way round. His exported `.mov` files
(`174688`, `174826`, both in the repository) are the automaton's output, and
they are labyrinthine self-similar blobs with no ring, no taper and no
filaments. Rendered next to the JPEGs they look like nothing on earth like each
other.

So: `ScriptLogoJpegs` are the film's logograms, isolated, thresholded and
captioned — one of them still has "Where is Abbott?" typeset into the bottom of
the frame, and an automaton cannot typeset. They are the target. The automaton
is an experiment performed *on* the target, and it is not a model of how the
film's ink looks.

#### What the automaton was doing, and why that was wrong twice

It went through two wrong jobs before being removed, and both were plausible:

1. **Tracing growth into geometry** — one hair per surviving cell. A CA is a
   grid and ink is not, so this produced a radial isotropic spray: the grammar
   of spatter, on a thin wire. It was recognisably wrong on sight.
2. **Measuring growth into a width** — how deep does the ink reach at each
   angle around a deposit, used as the stroke's half-width. This was better
   because it is invisible, and that is exactly the problem: the heavy regions
   became a CA silhouette in disguise and read like one. A CA's perpendicular
   profile is lumpy and scalloped where the reference blots are full-topped.

The honest summary is that the automaton's output space and the logograms'
appearance space do not overlap. What it was really providing was **variety**,
and noise provides variety more cheaply, more controllably, and in units that
can be measured against the target. So the blot is now modelled directly
(`ink/blot.js`).

The automaton remains in the repository, runnable, because it is the most
interesting thing in Wolfram's notebooks and because deleting it would lose the
finding below. It is not wired into `makeRingGlyph`.

#### The good-rule list is weaker than it looks

He generated random rules and kept the ones passing a filter; the filter's
literal form is

```wolfram
frames[[-1]] =!= frames[[-2]] &&
Times @@ ImageDimensions[frames[[-1]]] < 80000 &&
EuclideanDistance @@ BorderDimensions[frames[[-1]]] <
EuclideanDistance @@ BorderDimensions[frames[[1]]]
```

Read literally, the first term compares two **images**, so it is always true —
there is no rule for which it is false. `npm run probe:ca` re-runs the whole
analysis and prints both readings:

```
passing the filter as literally written: 10/13
passing the intended bounding-box test: 0/13
```

So what actually selected his list is the term as intended (a rule that is
still growing) plus the size bound. Two of the thirteen are excluded as dead:
`174688` stops at 126 cells and `256576` is the identity on a ring — it cost a
full automaton run to discover that one the hard way.

**The bit layout is likewise not guessable, so it was pinned empirically.** The
candidate is `bit = 9·colour + neighbourCount` (what `ca/rules.js` uses) against
`bit = 9·neighbourCount + colour`. Under the first, Wolfram's rules grow and
span a real range of behaviour. Under the second, all thirteen collapse into one
undifferentiated blob and 98–100% of random rules do nothing — which would mean
his hand-picked list was arbitrary. The layout is load-bearing.

**The rules are self-sustaining and flood the frame.** Run unbounded they reach
55–70% coverage within ten steps and keep going, which is why the notebook needs
700 steps bounded by the image itself.

### What a logogram actually is

This took three attempts and the first two were both plausible, which is why it
is worth stating as a picture rather than as parameters.

A reference logogram is:

    a thin circle, of near-constant weight, complete, drawn with an even hand
  + one to three compact dense blots of ink dropped on it
  + spikes, which leave the blots and nothing else
  + spatter, clustered on the blots

The two wrong models were:

  1. **A stroke whose width grows to ten times the hairline and tapers.** This
     reads as a glump stuck to a wire. The error was architectural and obvious
     on sight.
  2. **A stroke that swells gently into a tapered blade over 60 to 100 degrees
     of arc**, with filaments leaving it. Much closer to right, and it survived
     several rounds of measurement, because the *statistics* of a tapered blade
     and of a thin circle with blots on it overlap almost completely. Both give
     a median stroke around 1.7 times the thinnest part and a heavy tail.

     What kills it is looking at all 38 frames in one place. The circle is
     visibly a circle, of even weight, in every one of them; the heavy regions
     are visibly separate things sitting on it; and the filaments leave the
     heavy regions and never the circle. That last point is not a tendency. It
     is true of all 38 without exception, and in the wrong model it comes out
     wrong in a subtle way: a blot whose profile has tapered to almost nothing
     at its own edge still emits, so spikes sprout from ink that is hairline
     thin, and the picture reads as a hairy circle rather than a splashed one.
     Emission is therefore gated on the *local blot weight*, not on being
     nominally inside a blot's arc.

### Measured, and the mistake that corrupted the measurements

Two numbers matter more than the rest, and one of them was wrong for most of
this project's life.

**The ring is 0.016 to 0.043 R across**, and the thin end is much the most
common. The figure this project used for months, 0.043 for the *half*-width, was
derived from a screenshot at the very start and never re-derived — and every
later measurement was normalised against it, so the error went everywhere. The
ring it drew was two and a half times too heavy.

Everything above was measured with a **distance transform**, and that is not an
implementation detail. Every earlier attempt measured "how wide is the ink along
this ray", and every one of them was corrupted by the same artefact: where a
spike points outward, the ink is *contiguous* from the ring to the spike's tip,
so a ray through it reports ring and spike together as one enormous thickness.
That single artefact inflated the reported blot coverage to half the circle and
the peak width to eleven times the ring, and it is why the numbers kept
contradicting what the images plainly showed. A distance transform has no such
failure mode: a spike is thin *regardless of how long it is*.

| | low | median | high |
|---|---|---|---|
| ring, full width | 0.016 R | 0.035 R | 0.043 R |
| heaviest point, full width | 0.196 R | 0.243 R | 0.390 R |
| blot peak / ring | 6x | 13x | 21x |
| blots per logogram | 1 | 2 | 3 |
| circle carrying a blot | 14% | 49% | 83% |
| circle complete | 87% | 93% | 99% |
| filaments per logogram | 20 | 40 | 64 |
| filament reach, median | 0.06 R | 0.11 R | 0.20 R |
| filament reach, longest | 0.20 R | 0.40 R | 0.60 R |

These are **ranges, and they are wide** — coverage alone runs 14% to 83%. A
generator matching the median exactly would be wrong; a generator whose output
falls inside the range for every statistic is right. `tools/probe-ink.html`
flags out-of-range rather than a delta from a target.

One more finding from those measurements, because it is the single thing that
was most confidently got wrong by eye: **the filaments taper to a rounded
point; they do not club.** At low resolution the tips look clubbed. That reading
survives looking at the images — it only dies under measurement. A
cross-section profile taken along each filament falls monotonically, and the
largest club ratio anywhere in the corpus is 0.109, i.e. no filament in any
frame is wider at its tip than at its middle.

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
                   (both retained as the experiment; not in the render path)
  ink/
    glyph.js       one logogram as a list of weighted draw ops
    blot.js        one blot's width profile
    stroke.js      the circle, and the band that draws it
    offshoots.js   the filaments and spatter leaving a blot
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

**The order in `makeRingGlyph` is: blots first, then the circle that carries
them, then what leaves them.** An earlier version drew the ring first and laid
the heavy regions on afterwards, which is what forced a separate band and with
it the glump-on-a-wire look.

**`tools/reference/compare.html`** is the other file worth knowing about. It is
a dev tool, served by `npm run dev`, not a build entry.

---

## Keys

| | |
|---|---|
| click / tap | ask for a glyph where you clicked |
| `Space` | ask again, at the cursor |
| `U` | unwrap into twelve sections |
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
| `?unwrap` | start in the twelve-section view |
| `?proof=18` | contact sheet of bare logograms, no scene, fog or grade |
| `?seed=N` | override the opening glyph's seed |
| `?debug` | frame timing, mark progress, ink coverage, blot and filament counts |

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

Four views, and the fourth is the one that matters most:

| | |
|---|---|
| `interleave` | reference and generated alternately, so the eye judges species rather than detail |
| `pairs` | reference stacked over generated, for weight and shape |
| `refs` | all 38 reference frames as a set |
| `gen` | generated only |

**References-only is not a convenience, it is the tool.** Every wrong model this
project has had was wrong in a way that survived being looked at one frame at a
time and died when the whole set was seen together — the thin circle that is
always there, the blots that sit on it, and the spikes that leave the blots and
nothing else. Look at that view before changing anything.

`threshold` puts the generated ink through the same hard cut the reference
frames have had. Without it, anti-aliased edges are compared against hard ones
and the generated ink reads as softer than it is.

There is also **`tools/probe-ink.html`**, which is the other half of the loop:
it generates sixty glyphs, measures them exactly the way the reference figures
were measured, and flags any statistic that falls outside the reference range.
Eyeballing gets the shape; the probe catches scale, and scale is where every
wrong guess here has been made. It is linked from the comparison page.

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
  conflated. A fringe of filaments in clumps along the blot, fanning outward.
  *And* separate spatter — round and teardrop dots, about 56 of them, about 1%
  of the ink by area. An earlier version had only the first and called the
  second "bristles".
- **how heavy those filaments are** — about hairline weight, not a fraction of
  the blot they leave. Assuming they scale with the blot makes them five times
  too heavy, and it is a very natural assumption to make.
- **surface** — real ink over its own footprint is striated, with thin gaps
  running along the stroke where bristles did not touch. A uniformly filled
  band reads instantly as vector. The strip count follows the local width, and
  that is not a detail: a fixed eight strips across a hairline makes each strip
  sub-pixel, and sub-pixel quads antialias into a pale grey line — the entire
  quiet half of the ring came out washed out for exactly this reason.

---

## Performance

Measured in the desktop browser at 1056×2236, one tab. Two things were slow,
and neither was where it looked:

**Glyph build: 33ms → 5.2ms.** The automaton was never the biggest cost — about
5ms of it. Most of the rest was the interior ink haze: a 224² tile evaluated
with thirteen octaves of noise per pixel, then drawn at roughly three times its
own size and linearly filtered the whole way. There is nothing in a diffuse wash
for detail to survive in, so the tile dropped to 96². Removing the automaton
from the render path took the last of it.

**Unwrap view: 31fps → 61fps.** Its own draw call cost 0ms. The cost was
`mix-blend-mode: multiply` on a full-viewport overlay, which forces the
compositor to read back the WebGL layer and blend it into the stacking context
on every frame, whatever the overlay contains. Multiply looks marginally richer
because it darkens in proportion to what is behind — but over black ink,
ordinary alpha compositing darkens the same pixels by the same rule.

Measured build cost per glyph, median of eleven: **5.2ms**, and a typical glyph
is 70 ops — 54 stroke runs, 2-3 masses, around 20 filaments and 50-odd specks.
Scene and unwrap both hold 60fps.

### Cost of the striation

Drawing the band as longitudinal strips instead of one filled polygon multiplies
the fill count by up to eight, and it is worth the cost: it is the difference
between ink and a vector shape. It is not eight everywhere — the count follows
the local width (see above), so the circle is one fill and a blot is eight. The
whole thing measures as under a millisecond of the 5ms.

---

## Licence and attribution

The film imagery and the logogram designs belong to Paramount Pictures / the
*Arrival* production. Wolfram's notebooks are under the terms in that
repository's `COPYING.md`. Everything here is original code.
