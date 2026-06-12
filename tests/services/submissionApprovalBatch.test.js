import mongoose from "mongoose";
import Submission from "../../models/Submission.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import {
  approveSubmissionsBatch,
} from "../../services/submissionApprovalService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("approveSubmissionsBatch", () => {
  it("approves two pending submissions for the same company visit", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({ name: "Batch Co" });
    await CompanyVisit.updateOne(
      { _id: visit._id },
      { $set: { onlineQuestions: [], onlineQuestions_solution: [] } }
    );

    const subA = await Submission.create({
      companyId: staticRow._id,
      companyVisitId: visit._id,
      type: "onlineQuestions",
      content: JSON.stringify({ question: "Q Alpha", solution: "A1" }),
      status: "pending",
      submittedBy: { name: "U1", email: "u1@example.com" },
    });
    const subB = await Submission.create({
      companyId: staticRow._id,
      companyVisitId: visit._id,
      type: "onlineQuestions",
      content: JSON.stringify({ question: "Q Beta", solution: "B1" }),
      status: "pending",
      submittedBy: { name: "U2", email: "u2@example.com" },
    });

    const reviewer = { role: "admin", name: "Admin", email: "admin@example.com" };
    const summary = await approveSubmissionsBatch(
      [String(subA._id), String(subB._id)],
      reviewer
    );

    expect(summary.successCount).toBe(2);
    expect(summary.failCount).toBe(0);

    const updatedVisit = await CompanyVisit.findById(visit._id).lean();
    expect(updatedVisit.onlineQuestions).toEqual(
      expect.arrayContaining(["Q Alpha", "Q Beta"])
    );

    const refreshedA = await Submission.findById(subA._id).lean();
    const refreshedB = await Submission.findById(subB._id).lean();
    expect(refreshedA.status).toBe("approved");
    expect(refreshedB.status).toBe("approved");
  });

  it("returns per-id errors for unknown ids", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const summary = await approveSubmissionsBatch([String(fakeId)], {
      role: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
    expect(summary.successCount).toBe(0);
    expect(summary.failCount).toBe(1);
    expect(summary.results[0].ok).toBe(false);
  });
});
