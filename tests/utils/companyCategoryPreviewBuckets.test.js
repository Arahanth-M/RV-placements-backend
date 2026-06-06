import {
  visitQualifiesDreamTierRow,
  visitQualifiesInternshipOnlyHubRow,
  companyHasDreamTierVisitFromVisits,
  getCompanyDetailHeadlineTypeFromVisits,
  hasInternshipOnlyVisitForYear,
  getInternshipOnlyPlacementPrefFromVisits,
} from "../../utils/companyCategoryPreviewBuckets.js";

describe("companyCategoryPreviewBuckets — FTE vs internship-only", () => {
  const meFteVisit = {
    type: "FTE",
    offCampus: false,
    cluster: "ME",
    year: 2026,
    roles: [{ roleName: "Graduate Engineer", ctc: {}, internshipStipend: 40000 }],
  };

  it("qualifies FTE ME visit for dream tier even when roles only have stipend", () => {
    expect(visitQualifiesDreamTierRow(meFteVisit)).toBe(true);
    expect(visitQualifiesInternshipOnlyHubRow(meFteVisit)).toBe(false);
    expect(companyHasDreamTierVisitFromVisits([meFteVisit])).toBe(true);
  });

  it("still treats stipend-only rows as internship-only when type is not FTE", () => {
    const internshipOnly = {
      type: "Only Internship(6 months)",
      offCampus: false,
      roles: [{ roleName: "Intern", ctc: {}, internshipStipend: 25000 }],
    };
    expect(visitQualifiesDreamTierRow(internshipOnly)).toBe(false);
    expect(visitQualifiesInternshipOnlyHubRow(internshipOnly)).toBe(true);
  });

  it("internship_only context keeps visit type instead of dream FTE headline", () => {
    const fteVisit = {
      type: "FTE",
      offCampus: false,
      year: 2026,
      roles: [{ roleName: "SDE", ctc: { CTC: 1800000 } }],
    };
    const internshipOnlyVisit = {
      type: "Only internship(6 months)",
      offCampus: false,
      year: 2026,
      roles: [{ roleName: "Intern", ctc: {}, internshipStipend: 40000 }],
    };
    const visits = [fteVisit, internshipOnlyVisit];

    expect(
      getCompanyDetailHeadlineTypeFromVisits(
        visits,
        internshipOnlyVisit,
        2026,
        "internship_only",
        "cs"
      )
    ).toBe("Only internship(6 months)");

    expect(
      getCompanyDetailHeadlineTypeFromVisits(
        visits,
        internshipOnlyVisit,
        2026,
        null,
        "cs"
      )
    ).toBe("FTE");
  });

  it("scopes internship-only labels to the hub listing year", () => {
    const visits = [
      {
        type: "Only internship(6 months)",
        offCampus: false,
        year: 2026,
        roles: [{ roleName: "Intern", ctc: {}, internshipStipend: 40000 }],
      },
      {
        type: "Internship(PPO)",
        offCampus: false,
        year: 2027,
        roles: [{ roleName: "Intern", ctc: {}, internshipStipend: 50000 }],
      },
    ];

    expect(hasInternshipOnlyVisitForYear(visits, 2026)).toBe(true);
    expect(hasInternshipOnlyVisitForYear(visits, 2027)).toBe(false);

    expect(getInternshipOnlyPlacementPrefFromVisits(visits, 2026)).toEqual({
      displayType: "Only internship(6 months)",
      detailYear: 2026,
    });
    expect(getInternshipOnlyPlacementPrefFromVisits(visits, 2027)).toEqual({
      displayType: undefined,
      detailYear: undefined,
    });
  });
});
