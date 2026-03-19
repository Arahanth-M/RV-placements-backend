import InterviewSession from "../models/InterviewSession.js";

const updateOptions = {
  new: true,
  runValidators: true,
};

export const createSession = async (userId, companyId) => {
  return InterviewSession.create({
    userId,
    companyId,
    status: "in_progress",
  });
};

export const getSession = async (sessionId) => {
  return InterviewSession.findById(sessionId);
};

export const getInProgressSession = async (userId, companyId) => {
  return InterviewSession.findOne({
    userId,
    companyId,
    status: "in_progress",
  }).sort({ updatedAt: -1 });
};

export const getUserSessions = async (userId) => {
  return InterviewSession.find({ userId })
    .populate("companyId", "name type")
    .sort({ updatedAt: -1 });
};

export const discardInProgressSession = async (sessionId) => {
  return InterviewSession.findOneAndDelete({
    _id: sessionId,
    status: "in_progress",
  });
};

export const updateSession = async (sessionId, data) => {
  return InterviewSession.findByIdAndUpdate(
    sessionId,
    { $set: data },
    updateOptions
  );
};

export const addInteraction = async (sessionId, interactionObject) => {
  return InterviewSession.findByIdAndUpdate(
    sessionId,
    { $push: { history: interactionObject } },
    updateOptions
  );
};

