import mongoose from "mongoose";
import Submission from "../../models/Submission.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
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

  it("approves platform-scoped submissions onto company_platform_content, not visits", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({
      name: "Platform Batch Co",
    });
    await CompanyVisit.updateOne(
      { _id: visit._id },
      { $set: { onlineQuestions: ["Campus Q"], onlineQuestions_solution: ["Campus A"] } }
    );

    const sub = await Submission.create({
      companyId: staticRow._id,
      contentScope: "platform",
      type: "onlineQuestions",
      content: JSON.stringify({ question: "Platform Q", solution: "sol" }),
      status: "pending",
      submittedBy: { name: "U", email: "u@gmail.com" },
    });

    const summary = await approveSubmissionsBatch([String(sub._id)], {
      role: "admin",
      name: "Admin",
      email: "admin@example.com",
    });
    expect(summary.successCount).toBe(1);
    expect(summary.failCount).toBe(0);

    const visitAfter = await CompanyVisit.findById(visit._id).lean();
    expect(visitAfter.onlineQuestions).toEqual(["Campus Q"]);
    expect(visitAfter.onlineQuestions_solution).toEqual(["Campus A"]);

    const platform = await CompanyPlatformContent.findOne({
      companyId: staticRow._id,
    }).lean();
    expect(platform.onlineQuestions.map((item) => item.question)).toEqual([
      "Platform Q",
    ]);

    const refreshed = await Submission.findById(sub._id).lean();
    expect(refreshed.status).toBe("approved");
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
