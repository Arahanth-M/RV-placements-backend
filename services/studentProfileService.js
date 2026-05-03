import PlacementData from "../models/PlacementData.js";

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * Build the JSON body for GET /api/students/profile from a `students` document.
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
    profileSource: "students_split",
    student: studentRecord,
    placements,
    placementCompanies,
    primaryCompanyName,
    companyId: null,
    Name: normalizeText(studentRecord?.name) || null,
    Company: primaryCompanyName,
  };
}
