/** Bump when scoring logic or weights change (clients may cache by version). */
export const SCORER_VERSION = "1.3.1";

/** Relative weights for overall score (must sum to 1). */
export const BREAKDOWN_WEIGHTS = Object.freeze({
  completeness: 0.24,
  structure: 0.19,
  bulletQuality: 0.24,
  skills: 0.14,
  professionalism: 0.19,
});

export const LIMITS = Object.freeze({
  minSkillsRecommended: 6,
  maxSkillsRecommended: 28,
  minSummaryChars: 80,
  idealSummaryChars: 150,
  idealBulletMinChars: 40,
  idealBulletMaxChars: 200,
  minBulletWords: 8,
  idealBulletWordsMin: 10,
  idealBulletWordsMax: 26,
  minTokenLength: 2,
  maxTokenLength: 48,
  maxTips: 7,
  driveChecklistMax: 3,
  minCgpa: 5,
  maxCgpa: 10,
  minPercentage: 40,
  maxPercentage: 100,
});

export const THRESHOLDS = Object.freeze({
  strongScore: 85,
  moderateScore: 68,
  weakScore: 42,
  tipTriggerScore: 75,
  /** Praise / “looks strong” tips only at or above this category score. */
  praiseTipMinScore: 85,
  interviewReadyMinOverall: 70,
  minFilledEducationFields: 3,
  minExperienceBulletsWhenPresent: 2,
  minProjectBulletsWhenPresent: 2,
  skillsSweetSpotMin: 6,
  skillsSweetSpotMax: 18,
});

/** Common ATS action verbs (normalized matching in scoringUtils). */
export const ACTION_VERBS = Object.freeze([
  "achieved",
  "built",
  "created",
  "delivered",
  "designed",
  "developed",
  "engineered",
  "implemented",
  "improved",
  "increased",
  "launched",
  "led",
  "managed",
  "optimized",
  "reduced",
  "shipped",
  "spearheaded",
  "streamlined",
]);

/** Weak bullet phrase prefixes (case-insensitive). */
export const WEAK_BULLET_PATTERNS = Object.freeze([
  /^responsible for\b/i,
  /^helped with\b/i,
  /^worked on\b/i,
  /^assisted with\b/i,
  /^involved in\b/i,
  /^tasked with\b/i,
  /^participated in\b/i,
]);

/** Mid-sentence weak verbs (case-insensitive). */
export const WEAK_VERB_PATTERNS = Object.freeze([
  /\bhelped\b/i,
  /\bassisted\b/i,
  /\bparticipated\b/i,
  /\bsupported\b/i,
  /\bhandled\b/i,
  /\bworked on\b/i,
  /\bwas involved\b/i,
  /\bdid\b/i,
  /\bmade\b/i,
  /\bgot\b/i,
]);

/** Passive-voice heuristics (case-insensitive). */
export const PASSIVE_PHRASE_PATTERNS = Object.freeze([
  /\bwas\s+[a-z]+ed\b/i,
  /\bwere\s+[a-z]+ed\b/i,
  /\bbeen\s+[a-z]+ed\b/i,
  /\bbeing\s+[a-z]+ed\b/i,
  /\bis\s+[a-z]+ed\b/i,
  /\bare\s+[a-z]+ed\b/i,
  /\bby\s+the\s+team\b/i,
]);

/** Penalty / reward magnitudes used by scoringRules. */
export const SCORING_DELTAS = Object.freeze({
  missingRequiredField: 14,
  missingRecommendedField: 8,
  emptySection: 18,
  weakBullet: 20,
  strongBullet: 6,
  bulletWithMetric: 10,
  bulletIdealLength: 5,
  passiveBullet: 8,
  skillBelowMin: 22,
  skillAboveMax: 10,
  duplicateSkill: 5,
  invalidUrl: 6,
  missingCgpa: 8,
  unprofessionalEmail: 10,
});
