import {
  normalizeInterviewProcess,
  parseInterviewProcessToRoundHints,
} from "../interviewRoundInference.js";

/**
 * MCP tool: getNumberOfRounds
 * Responsibility: determine total rounds from company interviewProcess.
 * Fallback: if no interviewProcess is available, default to 3 rounds.
 */
export const getNumberOfRounds = async (companyData) => {
  const processItems = normalizeInterviewProcess(
    companyData?.interviewProcess || companyData?.interview_process
  );

  if (processItems.length === 0) {
    const defaultHints = Array.from({ length: 3 }, (_, index) => ({
      roundNumber: index + 1,
      about: `Round ${index + 1}`,
    }));
    return {
      totalRounds: 3,
      roundSegments: [],
      roundHints: defaultHints,
      source: "default",
    };
  }

  const { roundHints, roundSegments, source } = parseInterviewProcessToRoundHints(processItems);

  if (roundHints.length === 0) {
    const defaultHints = Array.from({ length: 3 }, (_, index) => ({
      roundNumber: index + 1,
      about: `Round ${index + 1}`,
    }));
    return {
      totalRounds: 3,
      roundSegments: [],
      roundHints: defaultHints,
      source: "default",
    };
  }

  return {
    totalRounds: roundHints.length,
    roundSegments,
    roundHints,
    source,
  };
};

export default getNumberOfRounds;
