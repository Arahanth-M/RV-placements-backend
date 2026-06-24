import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import mongoose from "mongoose";
import InterviewLimitRequest from "../../models/InterviewLimitRequest.js";
import Student from "../../models/Student.js";
import InterviewSession from "../../models/InterviewSession.js";
import {
  submitInterviewLimitRequest,
  getInterviewLimitRequestStatus,
  approveInterviewLimitRequest,
  resolveInterviewWeeklyLimitMax,
} from "../../services/interviewLimitRequestService.js";
import { INTERVIEW_STATES } from "../../services/interviewStateMachine.js";

describe("interviewLimitRequestService", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const email = `limit.request.${Date.now()}@test.rvce.edu.in`;
  let studentId;

  beforeEach(async () => {
    const student = await Student.create({
      name: "Limit Request Student",
      email,
      usn: "1RV22CS999",
    });
    studentId = student._id;
    await InterviewSession.create({
      userId,
      companyId: new mongoose.Types.ObjectId(),
      state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await InterviewLimitRequest.deleteMany({ userId });
    await InterviewSession.deleteMany({ userId });
    await Student.deleteMany({ _id: studentId });
  });

  it("submits a pending request when weekly limit is reached", async () => {
    const result = await submitInterviewLimitRequest(userId, { email });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");

    const status = await getInterviewLimitRequestStatus(userId);
    expect(status.status).toBe("pending");
  });

  it("approves a request and raises the student weekly cap", async () => {
    const submit = await submitInterviewLimitRequest(userId, { email });
    expect(submit.ok).toBe(true);

    const pending = await InterviewLimitRequest.findOne({ userId, status: "pending" }).lean();
    const approved = await approveInterviewLimitRequest(String(pending._id), {
      email: "admin@test.rvce.edu.in",
    });
    expect(approved.ok).toBe(true);

    const max = await resolveInterviewWeeklyLimitMax({ userId, email });
    expect(max).toBeGreaterThan(1);
  });
});
