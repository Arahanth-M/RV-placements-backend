/** Hub universities for multi-college company visit scoping (2026+ hub years). */
export const PLACEMENT_UNIVERSITY_KEYS = Object.freeze(["A", "B", "C", "D", "E"]);

export const PLACEMENT_UNIVERSITY_LABELS = Object.freeze({
  A: "College A",
  B: "College B",
  C: "College C",
  D: "College D",
  E: "College E",
});

/**
 * Normalize `?university=` / `?placementUniversity=` / visit.university to A–E.
 * @param {unknown} raw
 * @returns {"A"|"B"|"C"|"D"|"E"|null}
 */
export function normalizePlacementUniversityQuery(raw) {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (PLACEMENT_UNIVERSITY_KEYS.includes(v)) return v;
  return null;
}

/**
 * Map stored visit.university → hub key. Missing/invalid → null (strict isolation).
 * @param {unknown} raw
 * @returns {"A"|"B"|"C"|"D"|"E"|null}
 */
export function universityKeyFromVisitField(raw) {
  return normalizePlacementUniversityQuery(raw);
}
