import mongoose from "mongoose";
import CompanyVisit from "../../models/CompanyVisit.js";
import { collectRvceVisitRoleNames } from "../../utils/rvceVisitRoleNames.js";

/**
 * RVCE role titles stored on this company's rows in company_visits_with_rvitm.
 * @param {string} companyId
 * @returns {Promise<string[]>}
 */
export async function listRvceVisitRoles(companyId) {
  const id = String(companyId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return [];
  let oid;
  try {
    oid = new mongoose.Types.ObjectId(id);
  } catch {
    return [];
  }
  if (String(oid) !== id) return [];

  const visits = await CompanyVisit.find({
    $or: [{ companyId: oid }, { companyId: id }],
  })
    .select({ roles: 1 })
    .lean();

  return collectRvceVisitRoleNames(visits);
}
