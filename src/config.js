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
   * Ring stroke half-width, in ring-radius units. The pair is a range: each
   * glyph draws one value from it, so glyphs differ in how firmly they were
   * written.
   *
   * This is the only knob for ink weight, and it scales the whole glyph
   * coherently — the deposit swell in `widthAt`, the knot radius, the spatter
   * and the interior scratches are all `base` times a ratio. So the character
   * is preserved as you raise it: a faint wide halo pass over a narrow dark
   * core, heavy where the sector profile says there is ink.
   *
   * The practical ceiling is around 0.030. Past it the deposits stop reading
   * as bursts of ink and start reading as solid black lumps, because the knot
   * and spatter grow with `base` while the CA fuzz is sized independently by
   * `CA.cell` — so the fuzz stops being finer than the mass it sits in.
   */
  stroke: [0.021, 0.029],
  /** deposits per glyph */
  deposits: [2, 3],
  /** interior ink haze. This is a whisper: the film's haze barely tints the
   *  circle, and a large or strong one turns the whole glyph into a grey
   *  smudge with the ring drawn on top of it. */
  plumeAlpha: [0.028, 0.058],
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
  /** Wolfram's hand-picked good rules, most filamentary first */
  rules: [175622, 175780, 174794, 175950, 174826, 207594,
          174688, 175780, 174826, 175164, 176632, 47808, 207594, 256576],
  /** Size of one automaton cell, in ring radii. This is the resolution of the
   *  growth: at 0.012 there are ~80 cells per ring radius, which is fine
   *  enough for the filaments to read as hairs. Coarser than about 0.03 and
   *  the grid itself becomes visible. */
  cell: 0.012,
  /** grid cells across one deposit patch; must be at least
   *  2 * (reach / cell + margin) */
  patch: 112,
  /** dead margin around the growth, in cells */
  margin: 10,
  /** steps to run */
  steps: 34,
  /** growth reach as a fraction of the ring radius */
  reach: 0.34,
  /** how ragged the reach boundary is; 0 = a circle, which reads as artificial */
  wobble: 0.5,
  /** weight of a traced filament */
  detail: 1,

  /** steps for the whole-glyph mode, which seeds from the entire rasterised
   *  logogram as ca-01.nb does. Wolfram ran 700; at this grid that is ~40ms,
   *  which is a visible stall on click against a three-second draw. These
   *  rules reach their visual form well before 700 and then churn, so 150
   *  gives the same character for a fifth of the cost. */
  wholeSteps: 150,
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
