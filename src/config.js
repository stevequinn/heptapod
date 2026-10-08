/* ═══════════════════════════════════════════════════════════════════════════
   Tunables. Everything the look depends on lives here, so the scene modules
   stay about mechanism and not about magic numbers.
   ═══════════════════════════════════════════════════════════════════════════ */

export const INK = {
  /** Inscriptions held at full strength. One more may exist at a time, in the
   *  middle of its dissolve — a new glyph does not have to wait for a previous
   *  one to finish leaving before it can be written, so `marks.length` can
   *  reach `max + 1` briefly. */
  max: 4,
  /** how long a finished inscription is held before it starts to dissolve */
  hold: 10.0,
  /**
   * The dissolve itself. Deliberately slower than the inscription: the ink
   * comes apart the way it formed, so leaving should read as weather clearing
   * rather than as a switch being thrown.
   */
  dispel: 6.0,
  /** a forced retire (the pane is full) leaves by the same route, quickly */
  retire: 2.4,
  /** the wet-sheen buffer runs at this fraction of the ink buffer */
  wetScale: 1 / 3,
  /** ink buffer pixel budget; keeps huge displays from melting */
  budget: 1.5e6,
  /** how long one glyph takes to write itself, seconds */
  drawSeconds: 3.0,
};

/**
 * The room tone.
 *
 * One looping track. Browsers will not start audio without a gesture, so it
 * is armed rather than played and starts on the visitor's first click, tap or
 * key — see ui/sound.js. The preference is remembered; a visitor who turns it
 * off never hears it again until they turn it back on.
 */
export const SOUND = {
  /** playback volume, 0..1 */
  volume: 0.32,
  /** how long after the visitor's first gesture the room tone begins */
  delay: 0.1,
};

/**
 * Style calibration.
 *
 * The generator is a layered ink process — ring, accumulated stroke clusters,
 * bristles, flecks — and these are the knobs that decide how much of each a
 * glyph carries. They exist as a named, clamped block rather than as buried
 * constants so the review page can drive them directly: with the sliders wired
 * to these values the comparison sheet stops being a seed browser and becomes
 * a calibration surface, and a style found by eye can be written back here as
 * the default.
 *
 * Turn one up and one thing changes, not the whole picture:
 *
 *   clusterCount    how many dense deposits a glyph carries (mean, 1..4ish)
 *   clusterDensity  how many strokes each deposit is made of
 *   filamentDensity how many bristles and spines leave the deposits
 *   filamentLengthVariance  how uneven filament length is (0 = uniform)
 *   ringWobble      how far the base circle departs from a perfect circle
 *   inkRoughness    how irregular every boundary and every mark is
 *   microSplatter   how many flecks, ticks and stray specks are thrown
 */
export const STYLE = {
  clusterCount: 2.5,
  clusterDensity: 0.15,
  filamentDensity: 1.3,
  filamentLengthVariance: 0.2,
  ringWobble: 0.6,
  inkRoughness: 1.5,
  microSplatter: 0.0,
};

export const STYLE_RANGE = {
  clusterCount: [0.5, 4.5],
  clusterDensity: [0.15, 2.5],
  filamentDensity: [0.15, 2.5],
  filamentLengthVariance: [0, 2.5],
  ringWobble: [0, 2.5],
  inkRoughness: [0.2, 2.5],
  microSplatter: [0, 3],
};

/** merge a partial style over the defaults, clamping every value to range */
export function resolveStyle(overrides) {
  const out = { ...STYLE };
  if (!overrides) return out;
  for (const k of Object.keys(STYLE)) {
    const v = Number(overrides[k]);
    if (Number.isFinite(v)) {
      const [lo, hi] = STYLE_RANGE[k];
      out[k] = v < lo ? lo : v > hi ? hi : v;
    }
  }
  return out;
}

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
  pathSegments: 288,
  /**
   * Overall size, as a radius multiplier. The logograms in the film are not
   * all drawn on the same circle: they run up to about 20% different in
   * circumference, which at the scene scale reads as a difference in age or
   * emphasis rather than as a change of species. Sampling [0.91, 1.09] makes
   * the largest about 1.2x the smallest — a 20% difference in circumference.
   */
  size: [0.91, 1.09],
  /**
   * The ring: a thin line of near-constant weight, as a half-width in
   * ring-radius units. Measured across the reference frames, the circle runs
   * 0.016 to 0.043 R *across*, so a half-width of roughly 0.008 to 0.021 R.
   */
  ring: [0.012, 0.024],

  /** Base radius wobble, as three amplitudes (low, mid, high frequency).
   *  Hand-drawn, but compass-guided: the reference circles are clearly
   *  circles. Scaled by STYLE.ringWobble. */
  wobble: [0.055, 0.028, 0.013],
  /** how elliptic the ring is allowed to be. Off: the reference circles are
   *  round, and even a few percent of ellipticity reads as an oblong glyph
   *  rather than as a hand-drawn circle. */
  eccentricity: [0, 0],

  /** where the ring lifts off the glass, leaving a break. Most frames are a
   *  closed circle, so this is a chance per glyph and per break. */
  breakChance: 0.50,
  breaks: [0, 2],
  breakSpan: [0.06, 0.28],
  /** the brush lift: a long one-sided fade before the clean end of a break */
  breakLift: [0.06, 0.22],

  /** faint stretches, where the ink barely touched the glass */
  faintChance: 0.55,
  faintSpan: [0.20, 0.90],
  faintLevel: [0.22, 0.58],

  /** interior ink haze. A whisper: this is the film's haze, not the figure. */
  plumeAlpha: [0.004, 0.011],
  /** plume radius, in ring radii — under 1, so the haze clings to one side */
  plumeRadius: [0.40, 0.68],
};

/**
 * The dense clusters.
 *
 * The failure this configuration exists to kill: a cluster drawn as one filled
 * arc with a smooth width envelope. That reads as vector geometry no matter
 * how much noise is applied to its edge, because the *mass* is one coherent
 * shape. What the references have is deposition: a few hundred overlapping
 * brush strokes, deposits and flecks that happen to accumulate into a dark
 * region. The cluster's envelope below is therefore only a *placement field* —
 * where strokes are likely to land and how wide they are — and never a shape
 * that gets filled. See blot.js.
 */
export const BLOT = {
  /** angular half-span, radians. A deposit is compact first: 6-15 degrees
   *  across for most, up to about 34 for a wispy one. The tails that trail
   *  from them are sweeps, not body. */
  span: [0.10, 0.60],

  /** cluster peak half-width as a multiple of the ring's half-width. A
   *  deposit is wide along the arc and shallow across it; the deep end of
   *  this range is reserved for the occasional dominant mass. */
  peak: [3.5, 7.0],
  /** hard cap on the mass half-width in R (the heaviest reference is 0.195) */
  maxHalf: 0.195,

  /** envelope asymmetry: the width and the sharpness of each flank */
  sigma: [0.35, 0.65],
  sharp: [1.3, 2.4],
  /** a low shoulder that carries moderate ink a little way out along the
   *  span, so the deposit tapers into the ring instead of stopping dead */
  shoulder: [0.06, 0.16],

  /** multi-scale lumpiness of the placement envelope */
  lumpiness: 0.50,
  /** up to this many deep bites out of the envelope */
  bites: 3,

  /** pressure strokes — the body of the mass, all overlapping */
  strokes: [70, 220],
  /** near-solid deposits, short and heavy, at the wet core */
  deposits: [60, 150],
  /** small flake polygons at the core, where the ink is nearly solid */
  flakes: [24, 70],
  /** edge strokes that chew up the boundary */
  fringe: [16, 45],
  /** long dry-brush sweeps that trail along the ring */
  sweeps: [2, 5],
  /** thin scratches crossing the mass at an angle */
  scratches: [0, 4],
  /** paper holes left inside a cluster */
  holes: 3,
};

/**
 * The base stroke.
 *
 * The ring is a genuine band whose width varies along the circle, so it is
 * drawn as a filled band with torn edges rather than as hundreds of nervous
 * little strokes. Everything heavy is handled by blot.js.
 */
export const STROKE = {
  /** edge raggedness of the band, as a fraction of local width; scaled by
   *  STYLE.inkRoughness */
  ragged: 0.42,
  /** how much the lengthwise streaks separate, at the quiet ring and on a
   *  local swell */
  tear: [0.05, 0.28],
  /** below this noise value the tip skipped the glass and the streak is cut */
  skip: 0.13,
  /** the band sits this far out / in from the path, as fractions of width */
  poolOut: [0.65, 1.00],
  poolIn: [0.50, 0.85],

  /** local swells of the ring: how many, how strong, how wide (radians) */
  swell: [2, 4],
  swellAmp: [0.50, 1.50],
  swellSpan: [0.06, 0.22],

  /** scratch trails running beside the ring, mostly near clusters */
  trails: [2, 4],
  trailSpan: [0.12, 1.00],
  /** dry ticks — tiny short scratches along the circle */
  ticks: [20, 60],
};

/**
 * Bristles, spines and tendrils.
 *
 * All of these leave the accumulated mass, and most leave it along the
 * direction of a stroke that is already there — a bristle is the tail of the
 * brush, not a ray from the centre. Counts are per cluster, scaled by that
 * cluster's weight and by STYLE.filamentDensity.
 */
export const OFFSHOOT = {
  /** fine short hairs */
  fringe: [12, 32],
  /** longer filaments */
  medium: [6, 16],
  /** near-straight spines, the spectacular ones */
  spines: [0, 2],
  /** long curved tendrils that hook or loop */
  tendrils: [0, 3],

  /** visible length in R, per type */
  length: {
    fringe: [0.018, 0.075],
    medium: [0.050, 0.170],
    spine: [0.080, 0.260],
    tendril: [0.120, 0.380],
  },
  /** root half-width as a multiple of the hairline */
  width: {
    fringe: [0.25, 0.60],
    medium: [0.35, 0.75],
    spine: [0.45, 0.90],
    tendril: [0.60, 1.50],
  },
  /** direction mixture per type: [outward, tangential, inward] */
  mix: {
    fringe: [0.28, 0.58, 0.14],
    medium: [0.30, 0.55, 0.15],
    spine: [0.60, 0.35, 0.05],
    tendril: [0.12, 0.60, 0.28],
  },
  /** how strongly a filament continues the stroke it grew from (0..1) */
  inherit: 0.45,

  /** taper exponent, tip floor and lengthwise undulation, as measured */
  taper: 0.42,
  tipCap: 0.20,
  undulate: 0.38,
  undPeriods: 2.6,

  /** the tip knob: a pinch along the shaft, then a swollen rounded head.
   *  Scaled per type by its `bulb` factor (tendrils 1, fine hairs 0.35). */
  tipBulb: 0.55,
  bulbWidth: 0.13,
  neckAt: 0.80,
  neckWidth: 0.09,
  neckDepth: 0.55,

  maxLength: 0.34,
  /** exponent of the length distribution: higher packs more into short */
  lengthSkew: 1.5,
  /** chance of a long outlier, and the range it is multiplied by */
  outlier: [0.03, 1.2, 1.5],

  /** how much the filaments bow and curl, per type, as fractions of length */
  bow: {
    fringe: [0.005, 0.05],
    medium: [0.03, 0.12],
    spine: [0.02, 0.10],
    tendril: [0.04, 0.16],
  },
  curl: {
    fringe: [0.02, 0.14],
    medium: [0.05, 0.30],
    spine: [0.02, 0.14],
    tendril: [0.40, 1.00],
  },

  /** filaments are emitted in clumps: how many, and how widely they fan */
  clumps: [3, 6],
  clumpFan: 0.50,
  /** a root must sit on this fraction of the local envelope, or it is skipped */
  minLoad: 0.14,
};

/**
 * Spatter and micro-texture.
 *
 * Detached dots and flecks, clustered where the ink flicked and along the
 * scratch trails — never spread evenly over the frame. Scaled by
 * STYLE.microSplatter.
 */
export const SPATTER = {
  /** flecks per cluster */
  perMass: [10, 34],
  /** stray flecks anywhere on or near the ring */
  stray: [0, 8],
  /** dot radius, in ring radii */
  size: [0.0009, 0.0055],
  /** distance from the ring, in ring radii */
  reach: [0.02, 0.60],
  /** fraction of dots that are stretched teardrops */
  stretched: 0.40,
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
