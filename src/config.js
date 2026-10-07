/* ═══════════════════════════════════════════════════════════════════════════
   Tunables. Everything the look depends on lives here, so the scene modules
   stay about mechanism and not about magic numbers.
   ═══════════════════════════════════════════════════════════════════════════ */

export const INK = {
  /** Inscriptions held at full strength. One more may exist at a time, in the
   *  middle of its fade — a new glyph does not have to wait for a previous
   *  one to finish dissolving before it can be written, so `marks.length` can
   *  reach `max + 1` briefly. */
  max: 4,
  /** how long a finished inscription is held before it fades on its own */
  hold: 10.0,
  /** the fade itself */
  fade: 3.0,
  /** the wet-sheen buffer runs at this fraction of the ink buffer */
  wetScale: 1 / 3,
  /** ink buffer pixel budget; keeps huge displays from melting */
  budget: 1.5e6,
  /** how long one glyph takes to write itself, seconds */
  drawSeconds: 3.0,
};

/**
 * Logogram geometry.
 *
 * `sectors` is the important one. Wolfram's sectionBreaking-01.nb splits a
 * logogram into 12 angular wedges (sectionCount = 12) before comparing them,
 * and that is the structure we generate from: the ink weight of the ring is
 * described per sector rather than as a handful of hand-placed pools, which
 * is what gives each glyph its own identity.
 */
export const GLYPH = {
  sectors: 12,
  /** ring path resolution */
  pathSegments: 216,
  /**
   * The hairline: the stroke's half-width where there is no ink, in
   * ring-radius units.
   *
   * Measured on the 3300px originals rather than the translation sheet: on a
   * 75px-radius ring the thin part of a real logogram is ~3.5px wide, i.e.
   * ~0.023 of the radius. The blade peaks around 0.147 — a swell of roughly
   * 6.4x, which is what BRUSH.swellMax expresses.
   */
  stroke: [0.021, 0.027],

  /**
   * Ring radius wobble, as three amplitudes (low, mid, high frequency).
   *
   * Much smaller than a hand-drawn circle would suggest. These logograms were
   * compass-guided and the originals are strikingly round; an earlier version
   * at twice these amplitudes read as a wobbly circle rather than a glyph.
   */
  wobble: [0.055, 0.022, 0.010],
  /** deposits per glyph */
  deposits: [2, 3],
  /** interior ink haze. This is a whisper: the film's haze barely tints the
   *  circle, and a large or strong one turns the whole glyph into a grey
   *  smudge with the ring drawn on top of it. */
  plumeAlpha: [0.004, 0.011],
  /** plume radius, in ring radii — deliberately well under 1, so the haze
   *  clings to one side instead of filling the circle */
  plumeRadius: [0.40, 0.68],
};

/**
 * Cellular-automaton ink growth.
 *
 * Wolfram's ca-01.nb grows structures with 2-colour totalistic rules from a
 * binarised logogram, then keeps the rules that grow interestingly:
 * 174826, 174688, 174794, 175164, 175950, 176510, 175780, 192184, 175622,
 * 176632, 47808, 207594, 256576. Those rules are self-sustaining, so they
 * are run inside a per-deposit patch with an explicit reach budget; without
 * it they flood the frame.
 */
export const CA = {
  /* The rule numbers live in ca/rules.js, not here. An earlier copy of the list
     sat in this config and drifted: it went on naming 174688 and 256576 after
     both had been proved dead, and nothing read it anyway. One list, in the
     module that owns it. */

  /** Size of one automaton cell, in ring radii. This is the resolution of the
   *  growth: at 0.012 there are ~80 cells per ring radius, which is fine
   *  enough for the filaments to read as hairs. Coarser than about 0.03 and
   *  the grid itself becomes visible. */
  cell: 0.012,
  /** grid cells across one deposit patch; must be at least
   *  2 * (reach / cell + margin) */
  patch: 112,
  /** dead margin around the growth, in cells. Not decorative: growth.js asserts
   *  the patch is big enough for `reach` plus this, because a patch that is too
   *  small clips the growth at a square boundary and the clipping reads as a bug
   *  in the brush rather than as a misconfiguration. */
  margin: 10,
  /** steps to run */
  steps: 34,
  /**
   * How far the automaton's growth reaches, as a fraction of the ring radius.
   *
   * This is the growth *envelope*, not the stroke's weight — the distinction
   * matters, because the growth has to reach well past the blade for the
   * bristles to have anywhere to go. Bounded at the same value as the blade
   * (which is what it used to be) they were all emitted inside the mass and
   * completely hidden by it.
   *
   * How much of that envelope counts as *weight* is BRUSH.bladeReach.
   */
  reach: 0.30,
  /** how ragged the reach boundary is; 0 = a circle, which reads as artificial */
  wobble: 0.5,

  /** steps for the whole-glyph mode, which seeds from the entire rasterised
   *  logogram as ca-01.nb does. Wolfram ran 700; at this grid that is ~40ms,
   *  which is a visible stall on click against a three-second draw. These
   *  rules reach their visual form well before 700 and then churn, so 150
   *  gives the same character for a fifth of the cost. */
  wholeSteps: 150,
};

/**
 * The brush.
 *
 * One continuous stroke whose weight is the primary variable. The distinction
 * from an emitter is the whole point: a radial isotropic spray is the grammar
 * of spatter, and none of the reference glyphs look like that. The offshoots
 * are wedges with width, tapering to points, fanning along the direction of
 * travel.
 *
 * Every number here was read off the originals — see tools/reference.
 */
export const BRUSH = {
  /** peak blade half-width, as a multiple of the hairline. The ratio between
   *  the thin part of the stroke and its widest is the most legible thing about
   *  a logogram, and it is strikingly consistent across the references: on a
   *  75px-radius ring the hairline is ~3.5px and the blade ~22px, so ~6.4x. */
  swellMax: 6.4,

  /** the measured ink depth that maps to the peak blade half-width.
   *
   * Below CA.reach on purpose: a growth that fills the whole envelope is
   * extreme, and treating it as merely "full" would put every glyph's blade at
   * maximum and throw away the variation. A deposit whose automaton barely grew
   * gets a thin blade, which is the variation worth having. */
  bladeReach: 0.19,

  /** how much of a deposit's arc is fat, as an exponent on the automaton's
   *  measurement. Above 1 broadens the blade; a linear map leaves the swell
   *  pinched around one measurement, and the references have fat *runs* —
   * between 60 and 100 degrees of arc in every frame I measured. */
  swellGamma: 2.6,

  /** how far the bristles separate, at the hairline and at the blade. See
   *  BRUSH.strips — this is the curve that decides whether the ring reads as
   *  ink or as a faded photocopy of one. */
  tear: [0.16, 0.42],

  /** below this noise value the tip skipped the glass and the streak is cut */
  skip: 0.30,

  /** lengthwise streaks per band fill. This is the dry-brush striation: eight
   *  reads as a brush, three as a comb, and one is a solid polygon again. */
  strips: 8,

  /** how ragged the band's edge is */
  ragged: 0.34,

  /** Angular half-width of a deposit's arc, in radians. Wider than the ring's
   *  thirty-degree sectors, because a blade in the references runs to well over
   *  a quarter of the circle — the long axis being the tangent is what stops it
   *  reading as a lump. */
  arcSpan: 0.55,

  /** fine bristles leaving a wet mass, per deposit. The originals carry these —
   * a rough starburst of hairs wherever the ink pooled — and they are the
   * automaton's own growth used as texture rather than as the logogram itself,
   *  which is what it is actually good at.
   *
   *  Counted in tens, not hundreds. Every exposed cell in the growth emits one,
   *  and at 400 they piled into a solid fur pelt that read as a cloud stuck to
   *  the ring rather than as separate hairs. The references show 30 to 60
   *  distinct ones per mass, most of them short. */
  bristles: [26, 74],

  /** offshoots per deposit. The originals run from a single spur to a fan of
   *  ten or so ("Ian Louise Must Go"), so this is deliberately wide. */
  offshoots: [3, 10],
  offshootLength: [0.09, 0.34],
  /** how far off the tangent an offshoot may point, radians */
  offshootCone: 0.85,
  /** offshoot base half-width, as a fraction of the local stroke weight. The
   *  top of this range used to be 0.60, which at a 0.15 blade is a 9px-wide
   *  black wedge on a 75px ring — a fin, not a spur. Even 0.30 was too much:
   *  an offshoot in the references is a thin sharp stroke, not a petal. */
  offshootWidth: [0.06, 0.17],
};

export const UNWRAP = {
  /** radial span of the strip, in ring-radius units, centred on r = 1 */
  span: [0.30, 1.62],
  /** gap between wedge columns, as a fraction of column width */
  gutter: 0.16,
  /**
   * Device pixel ratio for the overlay.
   *
   * Deliberately below the scene's. The strip is thin rules and small text, so
   * extra resolution buys almost nothing visually — but the overlay is two
   * full-viewport layers and one of them is `mix-blend-mode: multiply`, so the
   * compositor has to read back the WebGL layer and blend, every frame,
   * whatever the overlay's own contents happen to be. At ratio 2 that blend
   * alone cost roughly a third of the frame rate.
   */
  dpr: 1.25,
};

export const SCENE = {
  /** DPR cap: this scene is fog, blur and grain, so retina costs a lot for
   *  almost no visible gain */
  maxPixelRatio: 1.5,
  /** the background renders at this fraction of the frame and is upscaled */
  bgScale: 0.5,
  /** bloom buffers are this fraction again */
  bloomScale: 0.25,
  /** idle spawn cadence, seconds — [lo, hi] */
  idleCadence: [6.0, 9.0],
  /** cadence while the visitor is playing with it */
  busyCadence: [3.2, 6.2],
  /** how long after a request before an unsolicited glyph may appear */
  quiet: 9,
};
