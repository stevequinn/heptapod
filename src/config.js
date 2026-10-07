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
   * Measured off the reference figures: the thinnest part of the stroke is
   * 0.043 R across, so a half-width of 0.0215. That number has been stable
   * across every way I have measured it and it is the one thing the first
   * version of this file already had right.
   */
  stroke: [0.021, 0.026],

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
 * The ink mass.
 *
 * A logogram is one stroke whose weight is the primary variable, and where it
 * is heavy it is a *blob of ink* — not a thick line. Everything here describes
 * that blob.
 *
 * Measured off the reference figures (3300px, isolated, thresholded; see
 * tools/reference). All figures are fractions of the ring radius R, and the
 * stroke's own width is quoted as a multiple of the hairline, because the ratio
 * between the thin part and the heavy part is the single most legible thing
 * about a logogram and is remarkably consistent from one frame to the next:
 *
 *   hairline          0.043 R full width  (half-width 0.022)
 *   median stroke     0.072 R             (1.7x)
 *   heavy region      0.226 R             (5.3x, and 24% of the circumference)
 *   heaviest          0.441 R             (10x)
 */
export const MASS = {
  /** peak half-width, as a multiple of the hairline. The top of the range is
   *  the measured 10x; the bottom is what a lesser deposit gets, and the spread
   *  between them is most of what makes one glyph differ from another. */
  peak: [4.6, 8.4],

  /** the shape of the swell across a deposit's arc, as an exponent on the
   *  parabolic blade in mass.js. Below 1 broadens the shoulders; above 1
   *  narrows them and sharpens the tips. */
  shoulder: 0.82,

  /** irregularity of the blob's outline, and how much it varies across the
   *  blob rather than uniformly. A smooth ellipse reads as a drawn shape. */
  lumpiness: 0.18,
  lumpFreq: 2.2,

  /** angular half-span of a deposit's mass, radians. The references run from
   *  about 40 to 65 degrees of arc at half-maximum, and they are big: between
   *  a fifth and a third of the whole circle is "heavy" in every frame. */
  span: [0.46, 0.86],
};

/**
 * The stroke — the band the mass swells out of.
 *
 * Kept in the references' own terms rather than as a drawing convenience:
 * real ink over its own path is striated lengthwise, with thin gaps where the
 * bristles did not touch, and a uniformly filled band reads instantly as vector.
 */
export const STROKE = {
  /** how far the bristles separate, at the hairline and at the mass. Note this
   *  runs the *other* way to what intuition suggests: the mass is the most
   *  solid part, because it is where the brush pressed hardest, and the tearing
   *  in the references happens at its *edge* rather than through its middle.
   *  Making the mass itself gappy is the obvious move and it produces grey
   *  airbrushed blobs where the references have black ones.
   *
   *  The values stay high overall for the same reason: remapped linearly, a
   *  mean-0.5 noise gives a mean alpha near 0.4 and the ring turns into a faded
   *  photocopy of a logogram. */
  tear: [0.22, 0.10],

  /** below this noise value the tip skipped the glass and the streak is cut */
  skip: 0.30,

  /** raggedness of the band's edge, on four scales — see ringBand() */
  ragged: 0.42,

  /** The quiet baseline: the hairline multiplied by [lo + hi * sectorProfile].
   *  The lo/hi split matters. This used to be [0.62, 0.85], which put the
   *  *median* stretch of stroke at the hairline — but the references' median is
   *  1.6x the hairline, so half the circle came out too thin. The measurements
   *  are a long tail from the hairline up to 10x, not a thin stroke with
   *  occasional blobs on it. */
  base: [0.66, 1.14],

  /** below this lift value the stroke comes off the glass entirely. The
   *  references have ~6% of the circle with no ink at all. */
  lift: 0.16,

  /** how much the band bulges outward under load, versus inward. Ink displaced
   *  by a brush travelling round a circle piles up on the outside of its line,
   *  and piles up more the harder it was pressed. */
  poolOut: [0.62, 1.20],
  poolIn: [0.44, 0.26],
};

/**
 * The offshoots.
 *
 * These are the thing most often got wrong. They are not bristles (too thin,
 * too many, too short), and they are not wedges along the tangent (wrong
 * direction, wrong scale). Measured, they are:
 *
 *   length            0.34 R at the median, 0.53 at p90, 0.80 at the maximum,
 *                     measured from the ring outward
 *   cross-section     0.032 R at the root — about *hairline* weight, not a
 *                     fraction of the mass
 *   direction         median 49 degrees off the tangent, p10 23, p90 70. That
 *                     is close to isotropic with a slight outward lean, which is
 *                     what a splash does. A tangential fan is a guess that the
 *                     measurement does not support.
 *   count             about 11 per logogram extend past 1.2 R, range 2 to 35
 *   tip               tapers to a *rounded* point. At low resolution the tips
 *                     look clubbed, which is an artefact of downscaling; a
 *                     cross-section profile measured along each filament falls
 *                     monotonically (tip/mid = 0.52).
 */
export const OFFSHOOT = {
  /** filaments per logogram. Scaled per deposit by how heavy it is, then this
   *  bounds the total. */
  count: [12, 30],

  /** length, in ring radii, from the root to the tip */
  length: [0.04, 0.48],

  /** root half-width, as a multiple of the hairline. Around 1 means a filament
   *  is about as heavy as the thinnest part of the stroke, which is what the
   *  measurements say and what the eye confirms. */
  width: [0.45, 1.15],

  /** exponent of the taper. The references fall *slowly* along most of the
   *  length and then round off, so this is well below 1 — a linear cone or a
   *  Gaussian both thin too fast and read as a spike of grass. See `tipCap`. */
  taper: 0.42,

  /** the cross-section the taper settles at before the end cap. Fitting the
   *  measured profiles gives w(u) = w0 * (0.18 + 0.82 (1-u)^0.42), and the
   *  round cap on the final segment turns this floor into the rounded end the
   *  references have. Setting it to 0 gives a mathematically sharp needle,
   *  which is the one thing they are not. */
  tipCap: 0.18,

  /** irregularity along the length — the visible nodes and swells. Straight
   *  conical filaments read as grass. */
  undulate: 0.38,
  undPeriods: 2.6,

  /** hard cap on a filament's reach. The outliers below would otherwise push
   *  past the longest filament in any reference frame, and a single absurd
   *  filament is more conspicuous than any number of dull ones. */
  maxLength: 0.60,

  /** the length distribution is skewed hard toward short: the references have
   *  a dense fringe of short filaments along the mass and only a handful of
   *  long ones. A uniform distribution over the same range puts too many long
   *  ones on and the fringe stops reading as a fringe. */
  lengthSkew: 1.9,

  /** how much the filament bows sideways over its length, radians */
  bow: [0.02, 0.13],

  /** angular spread of the emission direction about the outward radial, in
   *  radians. The measurement's p10-p90 is roughly +-40 degrees of the median,
   *  which a sum-of-three-uniforms scaled by this reproduces. */
  spread: 1.0,

  /** where along the mass a filament is emitted from, as a fraction of the
   *  mass's own half-span, and how deep inside the blob the root sits so the
   *  blob covers it */
  outlet: [0.15, 0.95],

  /** Filaments arrive in clumps, not a comb. The references' fringes are
   *  bunches of filaments from near the same point on the mass, fanning out,
   *  with bare stretches between the bunches. Spacing them evenly along the
   *  arc is the single clearest sign that a fringe is generated. */
  clumps: [2, 4],
  /** half-width of a clump along the mass, as a fraction of the mass's span */
  clumpSpread: 0.14,
  /** how tightly the directions within a clump agree. 0 is one shared
   *  direction for the whole clump, larger fans it out. */
  clumpFan: 0.55,
};

/**
 * Spatter.
 *
 * The references carry real speckle: around 56 detached dots per logogram,
 * each about 0.011 R across, together about 1% of the ink area, clustered
 * within about 1.5 R of the centre — thrown where the ink flicked, not sprayed
 * evenly over the frame.
 */
export const SPATTER = {
  perMass: [12, 34],
  /** dot radius, in ring radii */
  size: [0.0014, 0.0075],
  /** distance from the ring, in ring radii */
  reach: [0.02, 0.55],
  /** fraction of dots that are teardrops rather than round */
  stretched: 0.35,
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
