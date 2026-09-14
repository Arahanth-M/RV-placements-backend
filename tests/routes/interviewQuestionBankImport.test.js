import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { config } from "../../config/constants.js";
import CompanyStatic from "../../models/CompanyStatic.js";
import InterviewQuestion from "../../models/InterviewQuestion.js";
import interviewQuestionBankRouter from "../../routes/interviewQuestionBankRoutes.js";

const app = express();
app.use(express.json());
app.use("/api/interview-question-bank", interviewQuestionBankRouter);

const token = jwt.sign(
  {
    userId: "csv-import-test-user",
    _id: "507f1f77bcf86cd799439011",
    role: "student",
  },
  config.JWT_SECRET
);

const rubric = JSON.stringify([
  {
    text: "Covers the essential concept",
    category: "coverage",
    importance: "mustHave",
    expectedAnswerMode: "conceptual",
  },
]).replace(/"/g, '""');

const csv = [
  "questionId,title,question,companyTags,rubric",
  `csv-import-1,Cache basics,How would you explain caching?,Acme,"${rubric}"`,
].join("\n");

describe("interview question-bank CSV import", () => {
  beforeEach(async () => {
    await CompanyStatic.create({ name: "Acme", nameKey: "acme" });
  });

  it("inserts new rows and skips duplicate IDs without changing existing questions", async () => {
    const sendImport = () =>
      request(app)
        .post("/api/interview-question-bank/import")
        .set("Authorization", `Bearer ${token}`)
        .field("roleTags", JSON.stringify(["Backend Engineer"]))
        .field("roundType", "CS Fundamentals")
        .field("difficulty", "medium")
        .field("evaluationStrategy", "rubric_llm")
        .attach("file", Buffer.from(csv), {
          filename: "questions.csv",
          contentType: "text/csv",
        });

    const first = await sendImport().expect(201);
    expect(first.body).toMatchObject({
      totalRows: 1,
      inserted: 1,
      duplicates: 0,
      existingQuestionsChanged: 0,
    });

    const second = await sendImport().expect(200);
    expect(second.body).toMatchObject({
      inserted: 0,
      duplicates: 1,
      existingQuestionsChanged: 0,
    });
    expect(await InterviewQuestion.countDocuments({ questionId: "csv-import-1" })).toBe(1);
  });
});
