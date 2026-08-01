import mongoose from "mongoose";
import PrepPathPlan from "../../models/PrepPathPlan.js";
import { istDateParts, IST_OFFSET_MS } from "../../utils/istSlotTime.js";

/** UTC instant for start of current IST calendar day. */
function startOfIstDayUtc(date = new Date()) {
  const p = istDateParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/**
 * Peer PrepPath demand for a company over the last `windowDays` IST days.
 * Read-only aggregate on prep_path_plans. Never mutates other collections.
 */
export async function getCompanyPrepPathPeerDemand(companyId, { windowDays = 7 } = {}) {
  const id = String(companyId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return {
      companyId: id,
      windowDays,
      uniqueStudents: 0,
      planCount: 0,
      label: "",
      available: false,
    };
  }

  const days = Math.min(30, Math.max(1, Math.round(Number(windowDays) || 7)));
  const since = new Date(startOfIstDayUtc().getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const rows = await PrepPathPlan.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(id),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        planCount: { $sum: 1 },
        users: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        _id: 0,
        planCount: 1,
        uniqueStudents: { $size: "$users" },
      },
    },
  ]);

  const planCount = Number(rows[0]?.planCount) || 0;
  const uniqueStudents = Number(rows[0]?.uniqueStudents) || 0;

  let label = "";
  if (uniqueStudents <= 0) {
    label = "Be the first to generate a PrepPath for this company this week.";
  } else if (uniqueStudents === 1) {
    label = "1 student generated PrepPath for this company this week.";
  } else {
    label = `${uniqueStudents} students generated PrepPath for this company this week.`;
  }

  return {
    companyId: id,
    windowDays: days,
    since: since.toISOString(),
    uniqueStudents,
    planCount,
    label,
    available: true,
    hot: uniqueStudents >= 10,
  };
}
