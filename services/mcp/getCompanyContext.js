const toSafeString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return toSafeString(item.question || item.content || item.title);
      }
      return "";
    })
    .filter(Boolean);
};

/**
 * MCP tool: getCompanyContext
 * Returns a compact interview-relevant context used by downstream planners.
 */
export const getCompanyContext = async (companyData) => {
  const name = toSafeString(companyData?.name) || "Unknown Company";
  const interviewProcess = normalizeStringArray(
    companyData?.interviewProcess || companyData?.interview_process
  );
  const onlineQuestions = normalizeStringArray(
    companyData?.onlineQuestions || companyData?.online_questions
  );
  const interviewQuestions = normalizeStringArray(
    companyData?.interviewQuestions || companyData?.interview_questions
  );
  const mustDoTopics = normalizeStringArray(
    companyData?.Must_Do_Topics ||
      companyData?.must_do_topics ||
      companyData?.mustDoTopics
  );
  const prevCodingQuestions = normalizeStringArray(
    companyData?.prev_coding_ques || companyData?.prevCodingQuestions
  );

  // rounds source comes from interview process first; planner decides structure from this.
  const rounds = interviewProcess.slice(0, 12);

  return {
    name,
    rounds,
    onlineQuestions: onlineQuestions.slice(0, 20),
    interviewQuestions: interviewQuestions.slice(0, 20),
    mustDoTopics: mustDoTopics.slice(0, 20),
    prevCodingQuestions: prevCodingQuestions.slice(0, 20),
  };
};

export default getCompanyContext;

