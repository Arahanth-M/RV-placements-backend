export const INTERVIEW_STATES = {
  PREVIEW: "PREVIEW",
  IN_PROGRESS: "IN_PROGRESS",
  ROUND_ACTIVE: "ROUND_ACTIVE",
  EVALUATING: "EVALUATING",
  ROUND_COMPLETE: "ROUND_COMPLETE",
  INTERVIEW_COMPLETE: "INTERVIEW_COMPLETE",
};

const transitions = {
  PREVIEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["ROUND_ACTIVE"],
  ROUND_ACTIVE: ["EVALUATING"],
  EVALUATING: ["ROUND_ACTIVE", "ROUND_COMPLETE"],
  ROUND_COMPLETE: ["ROUND_ACTIVE", "INTERVIEW_COMPLETE"],
  INTERVIEW_COMPLETE: [],
};

export function canTransition(currentState, nextState) {
  return transitions[currentState]?.includes(nextState);
}

export function assertValidTransition(currentState, nextState) {
  if (!canTransition(currentState, nextState)) {
    throw new Error(`Invalid state transition from ${currentState} to ${nextState}`);
  }
}

