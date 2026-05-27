import { THRESHOLDS } from "./constants.js";

/**
 * Clamp a numeric score to the 0–100 range (integer).
 * @param {number} value
 * @param {number} [min=0]
 * @param {number} [max=100]
 * @returns {number}
 */
export function clampScore(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/**
 * @param {number} score
 * @param {number} penalty
 * @param {number} [floor=0]
 * @returns {number}
 */
export function applyPenalty(score, penalty, floor = 0) {
  return clampScore(score - penalty, floor, 100);
}

/**
 * @param {number} score
 * @param {number} reward
 * @param {number} [ceiling=100]
 * @returns {number}
 */
export function applyReward(score, reward, ceiling = 100) {
  return clampScore(score + reward, 0, ceiling);
}

/**
 * Score based on how many boolean checks passed.
 * @param {boolean[]} checks
 * @returns {number}
 */
export function scoreFromChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 0;
  const passed = checks.filter(Boolean).length;
  return clampScore((passed / checks.length) * 100);
}

/**
 * @param {number} present
 * @param {number} total
 * @returns {number}
 */
export function scoreRatio(present, total) {
  if (total <= 0) return 100;
  return clampScore((present / total) * 100);
}

/**
 * Weighted mean of { score, weight } entries. Ignores non-finite scores.
 * @param {{ score: number | null | undefined, weight: number }[]} entries
 * @returns {number}
 */
export function weightedMean(entries) {
  let sum = 0;
  let weightSum = 0;
  for (const entry of entries) {
    const w = Number(entry?.weight);
    const s = Number(entry?.score);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Number.isFinite(s)) continue;
    sum += s * w;
    weightSum += w;
  }
  if (weightSum <= 0) return 0;
  return clampScore(sum / weightSum);
}

/**
 * Blend a base score with a partial score using a ratio in [0, 1].
 * @param {number} baseScore
 * @param {number} partialScore
 * @param {number} ratio
 * @returns {number}
 */
export function blendScores(baseScore, partialScore, ratio) {
  const r = Math.min(1, Math.max(0, Number(ratio) || 0));
  return clampScore(baseScore * (1 - r) + partialScore * r);
}

/**
 * @param {number} score
 * @returns {"strong"|"moderate"|"weak"}
 */
export function scoreBand(score) {
  if (score >= THRESHOLDS.strongScore) return "strong";
  if (score >= THRESHOLDS.moderateScore) return "moderate";
  return "weak";
}

/**
 * Average numeric scores, skipping non-finite values. Returns 100 if empty.
 * @param {number[]} scores
 * @returns {number}
 */
export function averageScores(scores) {
  const valid = (Array.isArray(scores) ? scores : []).filter((s) => Number.isFinite(s));
  if (valid.length === 0) return 100;
  return clampScore(valid.reduce((a, b) => a + b, 0) / valid.length);
}
