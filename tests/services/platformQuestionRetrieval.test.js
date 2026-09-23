import InterviewQuestion from "../../models/InterviewQuestion.js";
import { retrieveQuestion } from "../../services/questionRetrievalService.js";
import { GENERAL_COMPANY_CATEGORY_PRODUCT } from "../../utils/generalCompanyCategory.js";

const mcqMeta = {
  options: [
    { id: "A", text: "Queue" },
    { id: "B", text: "Stack" },
    { id: "C", text: "Tree" },
    { id: "D", text: "Graph" },
  ],
  correctOptionId: "B",
};

describe("platform question retrieval (/general)", () => {
  beforeEach(async () => {
    await InterviewQuestion.deleteMany({ questionId: { $regex: "^platform-ret-" } });
  });

  afterEach(async () => {
    await InterviewQuestion.deleteMany({ questionId: { $regex: "^platform-ret-" } });
  });

  it("prefers category + single role over company + multi role", async () => {
    await InterviewQuestion.create([
      {
        questionId: "platform-ret-company-multi",
        title: "Company multi role",
        question: "MCQ company multi",
        companyTags: ["Google"],
        category: [GENERAL_COMPANY_CATEGORY_PRODUCT],
        roleTags: ["Frontend Engineer", "Full Stack Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "mcq_exact",
        mcqMetadata: mcqMeta,
      },
      {
        questionId: "platform-ret-category-single",
        title: "Category single role",
        question: "MCQ category single",
        companyTags: ["Other Co"],
        category: [GENERAL_COMPANY_CATEGORY_PRODUCT],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "mcq_exact",
        mcqMetadata: mcqMeta,
      },
    ]);

    const result = await retrieveQuestion({
      company: "Google",
      companyCategoryId: GENERAL_COMPANY_CATEGORY_PRODUCT,
      role: "Frontend Engineer",
      roundType: "CS Fundamentals",
      difficulty: "medium",
      questionKind: "mcq",
      platformMock: true,
    });

    expect(result?.questionId).toBe("platform-ret-category-single");
  });

  it("prefers exact company + single role when present", async () => {
    await InterviewQuestion.create([
      {
        questionId: "platform-ret-company-single",
        title: "Company single",
        question: "MCQ company single",
        companyTags: ["Google"],
        category: [GENERAL_COMPANY_CATEGORY_PRODUCT],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "mcq_exact",
        mcqMetadata: mcqMeta,
      },
      {
        questionId: "platform-ret-category-single-2",
        title: "Category single",
        question: "MCQ category single 2",
        companyTags: [],
        category: [GENERAL_COMPANY_CATEGORY_PRODUCT],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "mcq_exact",
        mcqMetadata: mcqMeta,
      },
    ]);

    const result = await retrieveQuestion({
      company: "Google",
      companyCategoryId: GENERAL_COMPANY_CATEGORY_PRODUCT,
      role: "Frontend Engineer",
      roundType: "CS Fundamentals",
      difficulty: "medium",
      questionKind: "mcq",
      platformMock: true,
    });

    expect(result?.questionId).toBe("platform-ret-company-single");
  });

  it("falls back to another role when the selected role has no bank rows", async () => {
    await InterviewQuestion.create([
      {
        questionId: "platform-ret-frontend-only",
        title: "Frontend only MCQ",
        question: "MCQ frontend only",
        companyTags: ["Google"],
        category: [GENERAL_COMPANY_CATEGORY_PRODUCT],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "mcq_exact",
        mcqMetadata: mcqMeta,
      },
    ]);

    const result = await retrieveQuestion({
      company: "Google",
      companyCategoryId: GENERAL_COMPANY_CATEGORY_PRODUCT,
      role: "Consultant",
      roundType: "CS Fundamentals",
      difficulty: "medium",
      questionKind: "mcq",
      platformMock: true,
    });

    expect(result?.questionId).toBe("platform-ret-frontend-only");
  });
});
