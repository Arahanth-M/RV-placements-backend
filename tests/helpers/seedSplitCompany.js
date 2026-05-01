import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import { COMPANY_VISIT_YEAR } from "../../services/companyService.js";

/**
 * Approved static + visit row for tests (replaces legacy `Company` seeding).
 * @param {Record<string, unknown>} [opts]
 * @returns {Promise<{ staticRow: import("mongoose").Document, visit: import("mongoose").Document }>}
 */
export async function seedApprovedSplitCompany(opts = {}) {
  const name = typeof opts.name === "string" ? opts.name : "Google Inc.";
  const nameKey =
    typeof opts.nameKey === "string"
      ? opts.nameKey
      : name.trim().toLowerCase();

  const staticRow = await CompanyStatic.create({
    name,
    nameKey,
    business_model: opts.business_model,
  });

  const visit = await CompanyVisit.create({
    companyId: staticRow._id,
    year: COMPANY_VISIT_YEAR,
    status: "approved",
    type: opts.type ?? "FTE",
    eligibility: opts.eligibility,
    date_of_visit: opts.date_of_visit,
    count: opts.count != null ? String(opts.count) : undefined,
  });

  return { staticRow, visit };
}
