/**
 * Lean payload for `GET /api/companies` (list / cards + hub marquee).
 * Keeps what CompanyStats + CompanyCard need; drops heavy visit/static fields
 * (questions, long copy, etc.) to shrink JSON and parse time. Detail view still uses `GET /:id`.
 */

/**
 * @param {unknown} ctc
 * @returns {unknown}
 */
function ctcToPlain(ctc) {
  if (ctc == null) return ctc;
  if (ctc instanceof Map) return Object.fromEntries(ctc);
  if (typeof ctc === "object" && !Array.isArray(ctc)) return ctc;
  return ctc;
}

/**
 * @param {Record<string, unknown>} c — already `attachPlacementCategoryToCompany` + `focusTags`
 * @returns {Record<string, unknown>}
 */
export function projectCompanyListResponse(c) {
  const resolveCluster = () => {
    const direct = c.cluster ?? c.Cluster;
    if (direct != null && String(direct).trim() !== "") return direct;
    for (const [k, v] of Object.entries(c || {})) {
      const key = String(k || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      if (key === "cluster" && v != null && String(v).trim() !== "") {
        return v;
      }
    }
    return "";
  };

  const roles = Array.isArray(c.roles)
    ? c.roles.map((r) => {
        if (!r || typeof r !== "object")
          return { ctc: null, internshipStipend: undefined };
        return {
          ctc: ctcToPlain(r.ctc),
          internshipStipend: r.internshipStipend,
        };
      })
    : [];

  return {
    _id: c._id,
    placementCompanyVisitId: c.placementCompanyVisitId,
    name: c.name,
    logo: c.logo,
    type: c.type,
    offCampus: c.offCampus,
    business_model: c.business_model,
    date_of_visit: c.date_of_visit,
    messageDate: c.messageDate,
    cluster: resolveCluster(),
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
    focusTags: c.focusTags,
    helpfulCount: c.helpfulCount,
    totalGotIn: c.totalGotIn,
    ppoConversionGotIn: Number(c.ppoConversionGotIn) || 0,
    ppoConversionConverted: Number(c.ppoConversionConverted) || 0,
    ppoConversionAcceptanceRate: Number(c.ppoConversionAcceptanceRate) || 0,
    ppoConversionType: c.ppoConversionType || "",
    ppoConversionNotApplicable: Boolean(c.ppoConversionNotApplicable),
    ppoBranchStats: Array.isArray(c.ppoBranchStats)
      ? c.ppoBranchStats.map((item) => ({
          branchCode: String(item?.branchCode || "").toLowerCase(),
          gotIn: Number(item?.gotIn) || 0,
          converted: Number(item?.converted) || 0,
          convertedNotApplicable: Boolean(item?.convertedNotApplicable),
        }))
      : [],
    totalGotInByYear: c.totalGotInByYear,
    category: c.category,
    totalCtcRupees: c.totalCtcRupees,
    roles,
    placementAnyYearPpoOnCampus: c.placementAnyYearPpoOnCampus,
    placementHasDreamTierVisit: c.placementHasDreamTierVisit,
    placementDreamTierForListingYear: c.placementDreamTierForListingYear,
    placementSummerInternshipForListingYear: c.placementSummerInternshipForListingYear,
    placementSummerStrictVisitForListingYear: c.placementSummerStrictVisitForListingYear,
    placementDreamDisplayType: c.placementDreamDisplayType,
    placementDreamDetailYear: c.placementDreamDetailYear,
    placementSummerDisplayType: c.placementSummerDisplayType,
    placementSummerDetailYear: c.placementSummerDetailYear,
    placementInternshipOnlyForListingYear: c.placementInternshipOnlyForListingYear,
    placementInternshipOnlyDisplayType: c.placementInternshipOnlyDisplayType,
    placementInternshipOnlyDetailYear: c.placementInternshipOnlyDetailYear,
    placementVisitYear: (() => {
      const y = Number(c.placementVisitYear ?? c.year);
      return Number.isFinite(y) && y > 2000 ? y : undefined;
    })(),
  };
}
