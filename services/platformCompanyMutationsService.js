import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import { normalizeSolutionText } from "../utils/normalizeSolutionText.js";

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

function approvedWithQuestion(items) {
  const refs = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item?.status && item.status !== "approved") continue;
    if (!text(item?.question)) continue;
    refs.push({ arrayIndex: i });
  }
  return refs;
}

function approvedExperiences(items) {
  const refs = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item?.status && item.status !== "approved") continue;
    if (!text(item?.content)) continue;
    refs.push({ arrayIndex: i });
  }
  return refs;
}

async function loadPlatformDoc(companyId) {
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
  let doc = await CompanyPlatformContent.findOne({ companyId: oid });
  if (!doc) {
    doc = await CompanyPlatformContent.create({ companyId: oid });
  }
  return { oid, doc };
}

function parseUiIndex(raw) {
  const index = parseInt(String(raw), 10);
  if (Number.isNaN(index) || index < 0) {
    const err = new Error("Invalid index");
    err.status = 400;
    throw err;
  }
  return index;
}

async function saveDoc(oid, doc) {
  await doc.save();
  await invalidateCompanyDetailCache(String(oid));
}

function applyQuestionUpdate(item, body) {
  if (!item) return;
  const { question, solution, intuition } = body || {};
  if (question !== undefined && question !== null) {
    item.question = text(question);
  }
  if (solution !== undefined && solution !== null) {
    item.answer = normalizeSolutionText(solution);
  }
  if (intuition !== undefined && intuition !== null) {
    item.intuition = normalizeSolutionText(intuition);
  }
}

export async function updatePlatformQuestion(companyId, field, uiIndex, body) {
  const index = parseUiIndex(uiIndex);
  if (!["onlineQuestions", "interviewQuestions"].includes(field)) {
    const err = new Error("Invalid question field");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const refs = approvedWithQuestion(doc[field]);
  const hit = refs[index];
  if (!hit) {
    const err = new Error("Question not found");
    err.status = 404;
    throw err;
  }
  applyQuestionUpdate(doc[field][hit.arrayIndex], body);
  doc.markModified(field);
  await saveDoc(oid, doc);
  return { message: "Question updated" };
}

export async function deletePlatformQuestion(companyId, field, uiIndex) {
  const index = parseUiIndex(uiIndex);
  if (!["onlineQuestions", "interviewQuestions"].includes(field)) {
    const err = new Error("Invalid question field");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const refs = approvedWithQuestion(doc[field]);
  const hit = refs[index];
  if (!hit) {
    const err = new Error("Question not found");
    err.status = 404;
    throw err;
  }
  doc[field].splice(hit.arrayIndex, 1);
  doc.markModified(field);
  await saveDoc(oid, doc);
  return { message: "Question deleted" };
}

export async function updatePlatformExperience(companyId, field, uiIndex, body) {
  const index = parseUiIndex(uiIndex);
  if (field !== "interviewExperiences") {
    const err = new Error("Invalid experience field");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const refs = approvedExperiences(doc[field]);
  const hit = refs[index];
  if (!hit) {
    const err = new Error("Experience not found");
    err.status = 404;
    throw err;
  }
  if (body?.content !== undefined && body?.content !== null) {
    doc[field][hit.arrayIndex].content = text(body.content);
  }
  doc.markModified(field);
  await saveDoc(oid, doc);
  return { message: "Experience updated" };
}

export async function deletePlatformExperience(companyId, field, uiIndex) {
  const index = parseUiIndex(uiIndex);
  if (field !== "interviewExperiences") {
    const err = new Error("Invalid experience field");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const refs = approvedExperiences(doc[field]);
  const hit = refs[index];
  if (!hit) {
    const err = new Error("Experience not found");
    err.status = 404;
    throw err;
  }
  doc[field].splice(hit.arrayIndex, 1);
  doc.markModified(field);
  await saveDoc(oid, doc);
  return { message: "Experience deleted" };
}

export async function updatePlatformMustDoByTopic(companyId, currentTopic, nextTopic) {
  const from = text(currentTopic);
  const to = text(nextTopic);
  if (!from || !to) {
    const err = new Error("Topic is required");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const list = Array.isArray(doc.mustDoTopics) ? doc.mustDoTopics : [];
  const hit = list.find(
    (row) =>
      (!row?.status || row.status === "approved") && text(row?.topic) === from
  );
  if (!hit) {
    const err = new Error("Must do topic not found on platform content");
    err.status = 404;
    throw err;
  }
  hit.topic = to;
  doc.mustDoTopics = list;
  doc.markModified("mustDoTopics");
  await saveDoc(oid, doc);
  return { message: "Must do topic updated" };
}

export async function deletePlatformMustDoByTopic(companyId, currentTopic) {
  const from = text(currentTopic);
  if (!from) {
    const err = new Error("Topic is required");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const list = Array.isArray(doc.mustDoTopics) ? doc.mustDoTopics : [];
  const arrayIndex = list.findIndex(
    (row) =>
      (!row?.status || row.status === "approved") && text(row?.topic) === from
  );
  if (arrayIndex < 0) {
    const err = new Error("Must do topic not found on platform content");
    err.status = 404;
    throw err;
  }
  list.splice(arrayIndex, 1);
  doc.mustDoTopics = list;
  doc.markModified("mustDoTopics");
  await saveDoc(oid, doc);
  return { message: "Must do topic deleted" };
}

export async function deletePlatformResearchSourceByUrl(companyId, url) {
  const target = text(url);
  if (!target) {
    const err = new Error("URL is required");
    err.status = 400;
    throw err;
  }
  const { oid, doc } = await loadPlatformDoc(companyId);
  const list = Array.isArray(doc.researchSources) ? doc.researchSources : [];
  const arrayIndex = list.findIndex((row) => text(row?.url) === target);
  if (arrayIndex < 0) {
    const err = new Error("Link not found");
    err.status = 404;
    throw err;
  }
  list.splice(arrayIndex, 1);
  doc.researchSources = list;
  doc.markModified("researchSources");
  await saveDoc(oid, doc);
  return { message: "Link deleted" };
}
