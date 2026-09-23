import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import XLSX from "xlsx";
import authJWT from "../middleware/authJWT.js";
import requirePlatformAdmin from "../middleware/requirePlatformAdmin.js";
import CompanyStatic from "../models/CompanyStatic.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import { PLATFORM_FRESHER_ROLES, PLATFORM_INTERVIEW_ROUND_TYPES } from "../config/interviewCatalog.js";
import {
  interviewQuestionBankBulkSchema,
  interviewQuestionBankWriteSchema,
  validateQuestionStrategy,
} from "../validations/interviewQuestionBank.validation.js";
import {
  buildCompanyNameToCategoryMap,
  categoriesFromCompanyTags,
  normalizeQuestionCategoryList,
} from "../utils/interviewQuestionCategoryFromCompanyTags.js";

const router = express.Router();
router.use(authJWT);
router.use(requirePlatformAdmin);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const csvName = /\.csv$/i.test(file.originalname || "");
    const csvMime = ["text/csv", "application/csv", "application/vnd.ms-excel"].includes(
      String(file.mimetype || "").toLowerCase()
    );
    callback(csvName || csvMime ? null : new Error("Only CSV files are allowed."), csvName || csvMime);
  },
});

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uniqueStrings = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];

const serializeValidationError = (error) =>
  error?.details?.map((detail) => detail.message).join(" ") || "Invalid question data.";

async function validateCompanyTags(companyTags) {
  const tags = uniqueStrings(companyTags);
  if (tags.length === 0) return { tags: [], error: "Select at least one company." };
  const rows = await CompanyStatic.find({ name: { $in: tags } }, { name: 1 }).lean();
  const found = new Set(rows.map((row) => String(row.name || "").trim()));
  const missing = tags.filter((tag) => !found.has(tag));
  return missing.length
    ? { tags, error: `Unknown company: ${missing.join(", ")}` }
    : { tags, error: "" };
}

function normalizeWritePayload(value, companyTags, category = []) {
  const resolvedCategory = normalizeQuestionCategoryList(
    category.length ? category : value.category
  );
  return {
    ...value,
    companyTags,
    category: resolvedCategory,
    roleTags: uniqueStrings(value.roleTags),
    topics: uniqueStrings(value.topics),
    subtopics: uniqueStrings(value.subtopics),
  };
}

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const parseJsonCell = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  return JSON.parse(String(value));
};

const parseCsvList = (value) => {
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(String(value || "").split(/[|;,]/));
};

function payloadFromCsvRow(row, defaults) {
  const options = ["A", "B", "C", "D", "E", "F"]
    .map((id) => ({
      id,
      text: String(row[`option${id}`] ?? row[`options_${id}`] ?? "").trim(),
      distractorReason: String(row[`distractorReason_${id}`] || "").trim(),
    }))
    .filter((option) => option.text);
  return {
    questionId: String(row.questionId || row.question_id || "").trim(),
    title: String(row.title || "").trim(),
    question: String(row.question || "").trim(),
    url: String(row.url || "").trim(),
    companyTags: parseCsvList(row.companyTags || row.companies || row.company),
    roleTags: defaults.roleTags,
    roundType: defaults.roundType,
    difficulty: defaults.difficulty,
    topics: parseCsvList(row.topics),
    subtopics: parseCsvList(row.subtopics),
    evaluationStrategy: defaults.evaluationStrategy,
    dsaMetadata: {
      supportedLanguages: parseCsvList(row.supportedLanguages || row.languages),
      starterCode: parseJsonCell(row.starterCode, null),
      functionSignature: String(row.functionSignature || "").trim(),
    },
    testCases: parseJsonCell(row.testCases, []),
    rubric: parseJsonCell(row.rubric, []),
    complexity: {
      time: String(row.timeComplexity || "").trim(),
      space: String(row.spaceComplexity || "").trim(),
    },
    sqlMetadata: {
      databaseSchema: String(row.databaseSchema || "").trim(),
      seedData: parseJsonCell(row.seedData, null),
      expectedResult: parseJsonCell(row.expectedResult, null),
      validationRules: parseCsvList(row.validationRules),
    },
    systemDesignMetadata: {
      requiredConcepts: parseCsvList(row.requiredConcepts),
    },
    hrMetadata: {
      behavioralSignals: parseCsvList(row.behavioralSignals),
    },
    mcqMetadata: {
      options,
      correctOptionId: String(row.correctOptionId || row.answer || "").trim().toUpperCase(),
      allowMultiple: parseBoolean(row.allowMultiple, false),
      shuffleOptions: parseBoolean(row.shuffleOptions, true),
      explanation: String(row.explanation || "").trim(),
      explanationRequired: parseBoolean(row.explanationRequired, false),
      selectionWeight: Number(row.selectionWeight || 1),
      explanationWeight: Number(row.explanationWeight || 0),
    },
    sourceMetadata: {
      source: String(row.source || "csv_import").trim(),
      verified: parseBoolean(row.verified, false),
      qualityScore: Number(row.qualityScore ?? 0.5),
    },
  };
}

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || "20"), 10) || 20));
    const filter = {};
    const search = String(req.query.search || "").trim();
    const company = String(req.query.company || "").trim();
    const role = String(req.query.role || "").trim();
    const roundType = String(req.query.roundType || "").trim();
    const difficulty = String(req.query.difficulty || "").trim();
    const strategy = String(req.query.evaluationStrategy || "").trim();
    const classification = String(req.query.classification || "").trim();

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ questionId: regex }, { title: regex }, { question: regex }];
    }
    if (company) filter.companyTags = company;
    if (role) filter.roleTags = role;
    if (roundType) filter.roundType = roundType;
    if (difficulty) filter.difficulty = difficulty;
    if (strategy) filter.evaluationStrategy = strategy;
    const missingClause =
      classification === "missing-company"
        ? { $or: [{ companyTags: { $exists: false } }, { companyTags: { $size: 0 } }] }
        : classification === "missing-role"
          ? { $or: [{ roleTags: { $exists: false } }, { roleTags: { $size: 0 } }] }
          : null;
    if (missingClause && filter.$or) {
      const searchClause = { $or: filter.$or };
      delete filter.$or;
      filter.$and = [searchClause, missingClause];
    } else if (missingClause) {
      Object.assign(filter, missingClause);
    }
    if (classification === "verified") filter["sourceMetadata.verified"] = true;
    if (classification === "unverified") filter["sourceMetadata.verified"] = { $ne: true };

    const [items, total, summary] = await Promise.all([
      InterviewQuestion.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      InterviewQuestion.countDocuments(filter),
      InterviewQuestion.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            missingCompany: {
              $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$companyTags", []] } }, 0] }, 0, 1] },
            },
            missingRole: {
              $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$roleTags", []] } }, 0] }, 0, 1] },
            },
            verified: { $sum: { $cond: [{ $eq: ["$sourceMetadata.verified", true] }, 1, 0] } },
          },
        },
      ]),
    ]);

    return res.json({
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: summary[0] || { total: 0, missingCompany: 0, missingRole: 0, verified: 0 },
    });
  } catch (error) {
    console.error("[interview-question-bank] list:", error?.message || error);
    return res.status(500).json({ error: "Could not load the interview question bank." });
  }
});

router.get("/coverage", async (_req, res) => {
  try {
    const rows = await InterviewQuestion.aggregate([
      {
        $group: {
          _id: {
            roundType: "$roundType",
            difficulty: "$difficulty",
          },
          count: { $sum: 1 },
          companies: { $addToSet: "$companyTags" },
          roles: { $addToSet: "$roleTags" },
        },
      },
      { $sort: { "_id.roundType": 1, "_id.difficulty": 1 } },
    ]);
    return res.json({
      rows: rows.map((row) => ({
        roundType: row._id?.roundType || "",
        difficulty: row._id?.difficulty || "",
        count: row.count || 0,
        companyTagSets: row.companies || [],
        roleTagSets: row.roles || [],
      })),
    });
  } catch (error) {
    console.error("[interview-question-bank] coverage:", error?.message || error);
    return res.status(500).json({ error: "Could not load bank coverage." });
  }
});

router.post(
  "/import",
  (req, res, next) => {
    csvUpload.single("file")(req, res, (error) => {
      if (error) return res.status(400).json({ error: error.message || "CSV upload failed." });
      return next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Upload a CSV using the form field "file".' });
      }

      let roleTags;
      try {
        roleTags = uniqueStrings(JSON.parse(String(req.body.roleTags || "[]")));
      } catch {
        return res.status(400).json({ error: "Selected roles are invalid." });
      }
      const allowedRoles = new Set(PLATFORM_FRESHER_ROLES);
      if (!roleTags.length || roleTags.some((role) => !allowedRoles.has(role))) {
        return res.status(400).json({ error: "Select at least one valid fresher role." });
      }

      const roundType = String(req.body.roundType || "").trim();
      const difficulty = String(req.body.difficulty || "").trim();
      const evaluationStrategy = String(req.body.evaluationStrategy || "").trim();
      if (!PLATFORM_INTERVIEW_ROUND_TYPES.includes(roundType)) {
        return res.status(400).json({ error: "Select a valid round type." });
      }
      if (!["easy", "medium", "hard"].includes(difficulty)) {
        return res.status(400).json({ error: "Select a valid difficulty." });
      }
      if (!["code_execution", "sql_execution", "rubric_llm", "behavioral_llm", "mcq_exact"].includes(evaluationStrategy)) {
        return res.status(400).json({ error: "Select a valid evaluation strategy." });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer", raw: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = firstSheet ? XLSX.utils.sheet_to_json(firstSheet, { defval: "" }) : [];
      if (!rows.length) return res.status(400).json({ error: "The CSV has no data rows." });
      if (rows.length > 1000) {
        return res.status(400).json({ error: "Import at most 1,000 questions per CSV." });
      }

      const companyRows = await CompanyStatic.find({}, { name: 1 }).lean();
      const knownCompanies = new Set(
        companyRows.map((company) => String(company.name || "").trim()).filter(Boolean)
      );
      const nameToCategory = await buildCompanyNameToCategoryMap();
      const validRows = [];
      const errors = [];

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        try {
          const rawPayload = payloadFromCsvRow(row, {
            roleTags,
            roundType,
            difficulty,
            evaluationStrategy,
          });
          const unknownCompanies = rawPayload.companyTags.filter(
            (company) => !knownCompanies.has(company)
          );
          if (unknownCompanies.length) {
            throw new Error(`Unknown company: ${unknownCompanies.join(", ")}`);
          }
          const { value, error } = interviewQuestionBankWriteSchema.validate(rawPayload, {
            abortEarly: false,
            stripUnknown: true,
          });
          if (error) throw new Error(serializeValidationError(error));
          const strategyError = validateQuestionStrategy(value);
          if (strategyError) throw new Error(strategyError);
          const category = categoriesFromCompanyTags(value.companyTags, nameToCategory);
          validRows.push({
            rowNumber,
            payload: normalizeWritePayload(value, value.companyTags, category),
          });
        } catch (error) {
          errors.push({
            row: rowNumber,
            questionId: String(row.questionId || row.question_id || "").trim(),
            error: error?.message || "Invalid row.",
          });
        }
      });

      let inserted = 0;
      let duplicates = 0;
      for (const entry of validRows) {
        try {
          await InterviewQuestion.create(entry.payload);
          inserted += 1;
        } catch (error) {
          if (error?.code === 11000) {
            duplicates += 1;
            errors.push({
              row: entry.rowNumber,
              questionId: entry.payload.questionId,
              error: "Duplicate questionId skipped; existing question was not changed.",
            });
          } else {
            errors.push({
              row: entry.rowNumber,
              questionId: entry.payload.questionId,
              error: error?.message || "Insert failed.",
            });
          }
        }
      }

      return res.status(inserted > 0 ? 201 : 200).json({
        totalRows: rows.length,
        validRows: validRows.length,
        inserted,
        duplicates,
        failed: errors.length - duplicates,
        errors: errors.slice(0, 200),
        existingQuestionsChanged: 0,
      });
    } catch (error) {
      console.error("[interview-question-bank] csv import:", error?.message || error);
      return res.status(500).json({ error: error?.message || "Could not import the CSV." });
    }
  }
);

router.post("/", async (req, res) => {
  try {
    const { value, error } = interviewQuestionBankWriteSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: serializeValidationError(error) });
    const companies = await validateCompanyTags(value.companyTags);
    if (companies.error) return res.status(400).json({ error: companies.error });
    const payload = normalizeWritePayload(value, companies.tags);
    const strategyError = validateQuestionStrategy(payload);
    if (strategyError) return res.status(400).json({ error: strategyError });
    const created = await InterviewQuestion.create(payload);
    return res.status(201).json(created);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "That question ID already exists." });
    }
    console.error("[interview-question-bank] create:", error?.message || error);
    return res.status(500).json({ error: error?.message || "Could not create the question." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid question ID." });
    }
    const { value, error } = interviewQuestionBankWriteSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: serializeValidationError(error) });
    const companies = await validateCompanyTags(value.companyTags);
    if (companies.error) return res.status(400).json({ error: companies.error });
    const payload = normalizeWritePayload(value, companies.tags);
    const strategyError = validateQuestionStrategy(payload);
    if (strategyError) return res.status(400).json({ error: strategyError });
    const updated = await InterviewQuestion.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ error: "Question not found." });
    return res.json(updated);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "That question ID already exists." });
    }
    console.error("[interview-question-bank] update:", error?.message || error);
    return res.status(500).json({ error: error?.message || "Could not update the question." });
  }
});

router.patch("/bulk/tags", async (req, res) => {
  try {
    const { value, error } = interviewQuestionBankBulkSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) return res.status(400).json({ error: serializeValidationError(error) });

    let values = uniqueStrings(value.values);
    if (value.field === "roleTags") {
      const allowed = new Set(PLATFORM_FRESHER_ROLES);
      const invalid = values.filter((item) => !allowed.has(item));
      if (invalid.length) return res.status(400).json({ error: `Unknown role: ${invalid.join(", ")}` });
    } else {
      const companies = await validateCompanyTags(values);
      if (companies.error) return res.status(400).json({ error: companies.error });
      values = companies.tags;
    }

    const update =
      value.operation === "add"
        ? { $addToSet: { [value.field]: { $each: values } } }
        : value.operation === "remove"
          ? { $pull: { [value.field]: { $in: values } } }
          : { $set: { [value.field]: values } };
    const result = await InterviewQuestion.updateMany(
      { _id: { $in: value.ids.map((id) => new mongoose.Types.ObjectId(id)) } },
      update,
      { runValidators: true }
    );
    return res.json({ matched: result.matchedCount || 0, modified: result.modifiedCount || 0 });
  } catch (error) {
    console.error("[interview-question-bank] bulk:", error?.message || error);
    return res.status(500).json({ error: error?.message || "Could not update questions." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid question ID." });
    }
    const deleted = await InterviewQuestion.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Question not found." });
    return res.json({ success: true });
  } catch (error) {
    console.error("[interview-question-bank] delete:", error?.message || error);
    return res.status(500).json({ error: "Could not delete the question." });
  }
});

router.get("/catalog", async (_req, res) => {
  return res.json({
    roles: PLATFORM_FRESHER_ROLES,
    roundTypes: PLATFORM_INTERVIEW_ROUND_TYPES,
  });
});

export default router;
