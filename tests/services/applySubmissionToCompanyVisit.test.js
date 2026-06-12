import CompanyVisit from "../../models/CompanyVisit.js";
import { applySubmissionToCompanyVisit } from "../../services/applySubmissionToCompanyVisit.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("applySubmissionToCompanyVisit", () => {
  it("appends a new online question and solution without rewriting unrelated visit fields", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({ name: "Mutex Test Co" });
    await CompanyVisit.updateOne(
      { _id: visit._id },
      {
        $set: {
          onlineQuestions: ["Existing Q"],
          onlineQuestions_solution: ["Existing A"],
          mcqQuestions: [
            {
              question: "MCQ stays",
              optionA: "a",
              optionB: "b",
              optionC: "c",
              optionD: "d",
              answer: "a",
            },
          ],
        },
      }
    );

    const submission = {
      type: "onlineQuestions",
      submittedBy: { name: "Tester", email: "t@example.com" },
      isAnonymous: false,
    };

    await applySubmissionToCompanyVisit(
      visit._id,
      staticRow._id,
      submission,
      JSON.stringify({ question: "New OA Q", solution: "New sol" })
    );

    const updated = await CompanyVisit.findById(visit._id).lean();
    expect(updated.onlineQuestions).toEqual(["Existing Q", "New OA Q"]);
    expect(updated.onlineQuestions_solution).toEqual(["Existing A", "New sol"]);
    expect(updated.mcqQuestions[0].question).toBe("MCQ stays");
  });

  it("merges solution when the question already exists", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({ name: "Dup Q Co" });
    await CompanyVisit.updateOne(
      { _id: visit._id },
      {
        $set: {
          onlineQuestions: ["Two Sum"],
          onlineQuestions_solution: ["Brute force"],
        },
      }
    );

    const submission = {
      type: "onlineQuestions",
      submittedBy: { name: "Tester", email: "t@example.com" },
      isAnonymous: false,
    };

    await applySubmissionToCompanyVisit(
      visit._id,
      staticRow._id,
      submission,
      JSON.stringify({ question: "Two Sum", solution: "Hash map" })
    );

    const updated = await CompanyVisit.findById(visit._id).lean();
    expect(updated.onlineQuestions).toEqual(["Two Sum"]);
    expect(updated.onlineQuestions_solution[0]).toContain("Brute force");
    expect(updated.onlineQuestions_solution[0]).toContain("Hash map");
  });
});
