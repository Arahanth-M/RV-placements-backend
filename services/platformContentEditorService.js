import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";

function asId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function mapSolutions(raw) {
  const sols = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    cpp: text(sols.cpp),
    java: text(sols.java),
    python: text(sols.python),
  };
}

function mapSubmittedBy(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const name = text(raw.name);
  const email = text(raw.email);
  if (!name && !email) return undefined;
  return { name, email };
}

function statusOf(raw) {
  return String(raw || "").trim() === "pending" ? "pending" : "approved";
}

function mapQuestionItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const question = text(raw.question);
  const answer = text(raw.answer);
  const intuition = text(raw.intuition);
  const solutions = mapSolutions(raw.solutions);
  const hasSolutions = Boolean(solutions.cpp || solutions.java || solutions.python);
  if (!question && !answer && !intuition && !hasSolutions) return null;
  const item = {
    kind: raw.kind === "coding" ? "coding" : "non_coding",
    question,
    answer,
    solutions,
    intuition,
    status: statusOf(raw.status),
    isAnonymous: raw.isAnonymous === true,
  };
  if (raw._id && mongoose.Types.ObjectId.isValid(String(raw._id))) {
    item._id = raw._id;
  }
  const submittedBy = mapSubmittedBy(raw.submittedBy);
  if (submittedBy) item.submittedBy = submittedBy;
  const reviewedBy = mapSubmittedBy(raw.reviewedBy);
  if (reviewedBy) item.reviewedBy = reviewedBy;
  if (raw.createdAt) item.createdAt = raw.createdAt;
  if (raw.approvedAt) item.approvedAt = raw.approvedAt;
  return item;
}

function mapExperienceItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const content = text(raw.content);
  if (!content) return null;
  const item = {
    content,
    status: statusOf(raw.status),
    isAnonymous: raw.isAnonymous === true,
  };
  if (raw._id && mongoose.Types.ObjectId.isValid(String(raw._id))) {
    item._id = raw._id;
  }
  const submittedBy = mapSubmittedBy(raw.submittedBy);
  if (submittedBy) item.submittedBy = submittedBy;
  const reviewedBy = mapSubmittedBy(raw.reviewedBy);
  if (reviewedBy) item.reviewedBy = reviewedBy;
  if (raw.createdAt) item.createdAt = raw.createdAt;
  if (raw.approvedAt) item.approvedAt = raw.approvedAt;
  return item;
}

function mapMustDoItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const topic = text(raw.topic);
  if (!topic) return null;
  const item = {
    topic,
    status: statusOf(raw.status),
  };
  if (raw._id && mongoose.Types.ObjectId.isValid(String(raw._id))) {
    item._id = raw._id;
  }
  const submittedBy = mapSubmittedBy(raw.submittedBy);
  if (submittedBy) item.submittedBy = submittedBy;
  if (raw.createdAt) item.createdAt = raw.createdAt;
  if (raw.approvedAt) item.approvedAt = raw.approvedAt;
  return item;
}

function mapCodingItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  let question = raw.question;
  if (typeof question === "string") {
    const trimmed = question.trim();
    if (!trimmed) question = null;
    else {
      try {
        question = JSON.parse(trimmed);
      } catch {
        question = { Title: trimmed };
      }
    }
  }
  const solutions = mapSolutions(raw.solutions);
  const intuition = text(raw.intuition);
  const hasQuestion =
    question != null &&
    (typeof question !== "object" || Object.keys(question).length > 0);
  const hasSolutions = Boolean(solutions.cpp || solutions.java || solutions.python);
  if (!hasQuestion && !hasSolutions && !intuition) return null;
  const item = {
    question: question ?? null,
    solutions,
    intuition,
    status: statusOf(raw.status),
  };
  if (raw._id && mongoose.Types.ObjectId.isValid(String(raw._id))) {
    item._id = raw._id;
  }
  const submittedBy = mapSubmittedBy(raw.submittedBy);
  if (submittedBy) item.submittedBy = submittedBy;
  if (raw.createdAt) item.createdAt = raw.createdAt;
  if (raw.approvedAt) item.approvedAt = raw.approvedAt;
  return item;
}

function mapMcqItem(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { question: trimmed };
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function serializeQuestion(item) {
  const sols = item?.solutions && typeof item.solutions === "object" ? item.solutions : {};
  return {
    _id: item?._id ? String(item._id) : "",
    kind: item?.kind === "coding" ? "coding" : "non_coding",
    question: text(item?.question),
    answer: text(item?.answer),
    solutions: mapSolutions(sols),
    intuition: text(item?.intuition),
    status: statusOf(item?.status),
    isAnonymous: item?.isAnonymous === true,
    submittedBy: item?.submittedBy || null,
    reviewedBy: item?.reviewedBy || null,
    createdAt: item?.createdAt || null,
    approvedAt: item?.approvedAt || null,
  };
}

function serializeExperience(item) {
  return {
    _id: item?._id ? String(item._id) : "",
    content: text(item?.content),
    status: statusOf(item?.status),
    isAnonymous: item?.isAnonymous === true,
    submittedBy: item?.submittedBy || null,
    reviewedBy: item?.reviewedBy || null,
    createdAt: item?.createdAt || null,
    approvedAt: item?.approvedAt || null,
  };
}

function serializeMustDo(item) {
  return {
    _id: item?._id ? String(item._id) : "",
    topic: text(item?.topic),
    status: statusOf(item?.status),
    submittedBy: item?.submittedBy || null,
    createdAt: item?.createdAt || null,
    approvedAt: item?.approvedAt || null,
  };
}

function serializeCoding(item) {
  const sols = item?.solutions && typeof item.solutions === "object" ? item.solutions : {};
  let questionJson = "";
  if (item?.question != null) {
    questionJson =
      typeof item.question === "string"
        ? item.question
        : JSON.stringify(item.question, null, 2);
  }
  return {
    _id: item?._id ? String(item._id) : "",
    questionJson,
    solutions: mapSolutions(sols),
    intuition: text(item?.intuition),
    status: statusOf(item?.status),
    submittedBy: item?.submittedBy || null,
    createdAt: item?.createdAt || null,
    approvedAt: item?.approvedAt || null,
  };
}

function serializeMcq(item, index) {
  return {
    key: item?._id ? String(item._id) : `mcq-${index}`,
    json:
      typeof item === "string"
        ? item
        : JSON.stringify(item ?? {}, null, 2),
  };
}

export function emptyPlatformEditorPayload(company) {
  return {
    companyId: company?._id ? String(company._id) : "",
    name: text(company?.name),
    logo: company?.logo || "",
    exists: false,
    onlineQuestions: [],
    interviewQuestions: [],
    interviewExperiences: [],
    internshipExperiences: [],
    mustDoTopics: [],
    codingQuestions: [],
    mcqQuestions: [],
  };
}

export async function getPlatformContentForEditor(companyId) {
  const oid = asId(companyId);
  if (!oid) return null;
  const staticRow = await CompanyStatic.findById(oid).lean();
  if (!staticRow) return null;
  const platform = await CompanyPlatformContent.findOne({ companyId: oid }).lean();
  if (!platform) return emptyPlatformEditorPayload(staticRow);
  return {
    companyId: String(staticRow._id),
    name: text(staticRow.name),
    logo: staticRow.logo || "",
    exists: true,
    onlineQuestions: (platform.onlineQuestions || []).map(serializeQuestion),
    interviewQuestions: (platform.interviewQuestions || []).map(serializeQuestion),
    interviewExperiences: (platform.interviewExperiences || []).map(serializeExperience),
    internshipExperiences: (platform.internshipExperiences || []).map(serializeExperience),
    mustDoTopics: (platform.mustDoTopics || []).map(serializeMustDo),
    codingQuestions: (platform.codingQuestions || []).map(serializeCoding),
    mcqQuestions: (platform.mcqQuestions || []).map(serializeMcq),
  };
}

export async function savePlatformContentFromEditor(companyId, body) {
  const oid = asId(companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }
  const staticRow = await CompanyStatic.findById(oid).lean();
  if (!staticRow) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }
  const payload = body && typeof body === "object" ? body : {};
  const update = {
    onlineQuestions: (payload.onlineQuestions || []).map(mapQuestionItem).filter(Boolean),
    interviewQuestions: (payload.interviewQuestions || []).map(mapQuestionItem).filter(Boolean),
    interviewExperiences: (payload.interviewExperiences || []).map(mapExperienceItem).filter(Boolean),
    internshipExperiences: (payload.internshipExperiences || [])
      .map(mapExperienceItem)
      .filter(Boolean),
    mustDoTopics: (payload.mustDoTopics || []).map(mapMustDoItem).filter(Boolean),
    codingQuestions: (payload.codingQuestions || []).map((row) =>
      mapCodingItem({
        ...row,
        question: row.questionJson != null ? row.questionJson : row.question,
      })
    ).filter(Boolean),
    mcqQuestions: (payload.mcqQuestions || [])
      .map((row) => mapMcqItem(row?.json != null ? row.json : row))
      .filter(Boolean),
  };

  await CompanyPlatformContent.findOneAndUpdate(
    { companyId: oid },
    { $set: update, $setOnInsert: { companyId: oid } },
    { upsert: true, new: true }
  );

  return getPlatformContentForEditor(companyId);
}
