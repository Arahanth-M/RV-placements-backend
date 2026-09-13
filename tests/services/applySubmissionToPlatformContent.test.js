import CompanyVisit from "../../models/CompanyVisit.js";
import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { applySubmissionToPlatformContent } from "../../services/applySubmissionToPlatformContent.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("applySubmissionToPlatformContent", () => {
  it("appends OA onto company_platform_content and does not change visits", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({
      name: "Platform OA Co",
    });
    await CompanyVisit.updateOne(
      { _id: visit._id },
      {
        $set: {
          onlineQuestions: ["Campus Q"],
          onlineQuestions_solution: ["Campus A"],
        },
      }
    );

    await applySubmissionToPlatformContent(
      staticRow._id,
      {
        type: "onlineQuestions",
        submittedBy: { name: "Gmail User", email: "u@gmail.com" },
        isAnonymous: false,
      },
      JSON.stringify({
        question: "Two Sum",
        solution: "#include <bits/stdc++.h>\nint main() { return 0; }",
      })
    );

    const platform = await CompanyPlatformContent.findOne({
      companyId: staticRow._id,
    }).lean();
    expect(platform.onlineQuestions).toHaveLength(1);
    expect(platform.onlineQuestions[0].question).toBe("Two Sum");
    expect(platform.onlineQuestions[0].kind).toBe("coding");
    expect(platform.onlineQuestions[0].solutions.cpp).toContain("#include");
    expect(platform.onlineQuestions[0].solutions.java).toBe("");
    expect(platform.onlineQuestions[0].solutions.python).toBe("");

    const visitAfter = await CompanyVisit.findById(visit._id).lean();
    expect(visitAfter.onlineQuestions).toEqual(["Campus Q"]);
    expect(visitAfter.onlineQuestions_solution).toEqual(["Campus A"]);
  });

  it("skips a duplicate question on the same platform company", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Platform Dup Co",
    });
    await applySubmissionToPlatformContent(
      staticRow._id,
      {
        type: "interviewQuestions",
        submittedBy: { name: "A", email: "a@gmail.com" },
      },
      JSON.stringify({ question: "What is REST?", solution: "Representational state" })
    );
    await applySubmissionToPlatformContent(
      staticRow._id,
      {
        type: "interviewQuestions",
        submittedBy: { name: "B", email: "b@gmail.com" },
      },
      JSON.stringify({ question: "What is REST?", solution: "duplicate" })
    );

    const platform = await CompanyPlatformContent.findOne({
      companyId: staticRow._id,
    }).lean();
    expect(platform.interviewQuestions).toHaveLength(1);
    expect(platform.interviewQuestions[0].answer).toBe("Representational state");
  });
});
