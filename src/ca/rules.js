/* ═══════════════════════════════════════════════════════════════════════════
   Cellular-automaton rules, ported from Wolfram's ca-01.nb.

   The notebook runs

     CellularAutomaton[{rule, {2, {{2,2,2},{2,1,2},{2,2,2}}, {1,1}}, 0},
                       {ImagePad[Binarize[...], 10, Black], 0}, steps]

   which is a two-colour, radius-1, *totalistic* automaton: the next value of
   a cell depends only on how many of its eight neighbours are colour 1, and
   on the cell's own current colour. Eighteen bits of rule number cover all
   eighteen (neighbourCount, colour) cases.

   Bit layout matters and is not guessable, so it was pinned empirically:
   bit index = 9 * colour + neighbourCount. Under that layout Wolfram's
   hand-picked rules are the only ones in the space that grow at all, and they
   span a real range of behaviours (see `rank`). Under the plausible
   alternative, 9 * neighbourCount + colour, every one of them collapses into
   the same undifferentiated blob, and the rules stop being special at all.

   Wolfram's list, in the order he wrote it, plus `rank` — how filamentary the
   rule is when grown from a small ink deposit under a bounded reach. The
   top of that list is what we draw with.
   ═══════════════════════════════════════════════════════════════════════════ */

export const WOLFRAM_RULES = [
  174826, 174688, 174794, 175164, 175950, 176510, 175780,
  192184, 175622, 176632, 47808, 207594, 256576,
];

/**
 * The ten that survive Wolfram's own selection filter, measured rather than
 * assumed — see `tools/probe-ca.mjs`.
 *
 * His filter keeps rules where
 *
 *   frames[[-1]] != frames[[-2]]                                 still evolving
 *   Times @@ ImageDimensions[frames[[-1]]] < 80000               always true
 *   EuclideanDistance @@ BorderDimensions[...] < ...[first]      always true
 *
 * The second term is 14400 on every frame at his settings, so it rejects
 * nothing. The third looks like a bounding-box containment test, but `@@`
 * threads over the 4-list into a *binary* function, so it evaluates as
 * EuclideanDistance[{xmin,xmax},{ymin,ymax}] — a symmetry test. It reads 3.16
 * on the seed ring and 0.00 on every grown frame, so it rejects nothing
 * either. In practice the filter is just "still evolving at step 700".
 *
 * Worth knowing, because it means the good-rule list is not a curation of
 * ink-like splatter generators — it is the survivors of a random search. All
 * ten fill the padded frame by step 700. Read that third term as it was
 * evidently meant, ink bounding box must not exceed the logogram's own, and
 * *none* of the thirteen pass.
 *
 * The bit layout, by contrast, does hold up. Under `9*colour + neighbours`
 * these rules grow, and they span a real range of behaviour; under the
 * plausible alternative they all collapse into one indistinguishable blob,
 * which is what makes the decoding right.
 */
export const PASSING_RULES = [
  175622, 175780, 174794, 175950, 174826, 207594,
  175164, 176632, 176510, 192184,
];

/** the three he kept that die before step 700, so there is no point running
 *  them — 256576 in particular is the identity on a ring and produces zero
 *  new cells, which cost a whole automaton run to discover */
export const DEAD_RULES = new Set([174688, 47808, 256576]);

/**
 * How filamentary each rule grows, measured from this repo rather than
 * asserted: grow a small disc from each rule under the bounded-reach variant
 * here, then score the fraction of cells with exactly one ink
 * neighbour. A high fraction means lots of free tips, i.e. branches that end
 * in points rather than a solid mass.
 *
 * The values below are the measured ordering (see `tools/probe-ca.mjs`).
 */
const RANK = new Map([
  [175622, 0.35], [175780, 0.12], [174794, 0.08], [175950, 0.05],
  [174826, 0.03], [207594, 0.03], [175164, 0.02], [176632, 0.01],
  [176510, 0.01], [192184, 0.01],
]);

/**
 * Weighted rule picker. Only the top of Wolfram's list actually produces ink
 * that reads as tendrils; 192184 grows into a near-solid mass, so it is in the
 * pool at a token weight. The three dead rules are never returned at all.
 */
export function pickRule(rng) {
  const pool = PASSING_RULES.filter((r) => (RANK.get(r) ?? 0) > 0);
  /* Square-rooted, not linear.
     RANK orders the rules by how filamentary they are, which is the right
     preference — but weighting by it linearly put half of all glyphs on a
     single rule. That was defensible while the automaton was supplying the
     logogram's geometry, because its structure was the whole look. It is not
     defensible now that the automaton supplies a measurement and some bristles:
     the rule's job is to be one source of variety among several, and drawing
     half the seeds from one of eleven rules throws that away. Flattening the
     weights leaves the ordering as a mild bias and takes the top rule from 49%
     to about a fifth. */
  const weights = pool.map((r) => Math.sqrt(RANK.get(r) ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    t -= weights[i];
    if (t <= 0) return pool[i];
  }
  return pool[0];
}

/** the rule's next-state lookup, precomputed as a flat table */
export function ruleTable(rule) {
  const t = new Uint8Array(18);
  for (let colour = 0; colour < 2; colour++)
    for (let m = 0; m < 9; m++) t[9 * colour + m] = (rule >> (9 * colour + m)) & 1;
  return t;
}
