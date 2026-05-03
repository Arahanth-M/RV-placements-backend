import PlacementData from "../models/PlacementData.js";

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * USN lookup response shape (legacy-friendly fields for the client).
 */
export function buildUsnLookupStudentPayload(studentRecord, placements) {
  const sorted = Array.isArray(placements)
    ? [...placements].sort(
        (a, b) =>
          new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
      )
    : [];
  const primary = sorted[0] || null;
  const company = normalizeText(primary?.companyPlaced);
  const placementCompanies = [];
  const seen = new Set();
  for (const p of sorted) {
    const n = normalizeText(p?.companyPlaced);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    placementCompanies.push({ companyName: n });
  }
  return {
    ...studentRecord,
    Name: normalizeText(studentRecord?.name) || null,
    USN: normalizeText(studentRecord?.usn) || null,
    placedCompany: company || undefined,
    CTC: normalizeText(primary?.ctc) || normalizeText(primary?.base) || "",
    "Type of Offer": normalizeText(primary?.typeOfOffer) || "",
    placements: sorted,
    placementCompanies,
    primaryCompanyName: company || null,
    student: studentRecord,
  };
}

/**
 * Build the JSON body for GET /api/students/profile from a student document.
 * Used on cache miss after DB read; keeps one source of truth for the payload shape.
 */
export async function buildProfilePayloadFromStudentRecord(studentRecord) {
  const placements = await PlacementData.find({ studentId: studentRecord._id })
    .sort({ createdAt: -1 })
    .lean();

  const placementCompanyMap = new Map();
  for (const placement of placements) {
    const companyName = normalizeText(placement?.companyPlaced);
    if (!companyName) continue;
    const key = companyName.toLowerCase();
    if (!placementCompanyMap.has(key)) {
      placementCompanyMap.set(key, companyName);
    }
  }
  const placementCompanyNames = Array.from(placementCompanyMap.values());
  const placementCompanies = placementCompanyNames.map((companyName) => ({
    companyName,
  }));
  const primaryCompanyName = placementCompanyNames[0] || null;

  return {
    profileSource: "split_profile",
    student: studentRecord,
    placements,
    placementCompanies,
    primaryCompanyName,
    companyId: null,
    Name: normalizeText(studentRecord?.name) || null,
    Company: primaryCompanyName,
  };
}
