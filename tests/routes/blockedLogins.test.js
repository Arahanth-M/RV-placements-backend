import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../server.js";
import User1 from "../../models/User1.js";
import DauDayUser from "../../models/DauDayUser.js";
import {
  recordBlockedLoginAttempt,
  signBlockedLoginIntentToken,
} from "../../services/blockedLoginAttempts.js";
import { config } from "../../config/constants.js";

describe("blocked login interest routes", () => {
  it("rejects a missing body", async () => {
    const response = await request(app)
      .post("/api/auth/blocked-login-interest")
      .send({})
      .expect(400);
    expect(response.body.message).toBe("Validation error");
  });

  it("rejects an invalid interest token", async () => {
    const response = await request(app)
      .post("/api/auth/blocked-login-interest")
      .send({
        token: "a".repeat(24),
        collegeName: "PES University",
        wantsPlatformAtCollege: true,
      })
      .expect(401);
    expect(response.body.error).toMatch(/expired/i);
  });

  it("saves college interest without creating a session or user", async () => {
    const attemptId = await recordBlockedLoginAttempt({
      email: "route-test@gmail.com",
      displayName: "Route Test",
    });
    const token = signBlockedLoginIntentToken(attemptId);
    const response = await request(app)
      .post("/api/auth/blocked-login-interest")
      .send({
        token,
        collegeName: "BMS College of Engineering",
        wantsPlatformAtCollege: true,
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.collegeName).toBe("BMS College of Engineering");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await User1.countDocuments()).toBe(0);
    expect(await DauDayUser.countDocuments()).toBe(0);
  });

  it("requires an admin session for the summary", async () => {
    await request(app).get("/api/admin/blocked-logins").expect(401);
  });

  it("returns summary for an admin JWT", async () => {
    const token = jwt.sign(
      {
        userId: "admin-google",
        _id: "507f1f77bcf86cd799439011",
        email: "placement@rvce.edu.in",
        role: "admin",
        isAdminSession: true,
      },
      config.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const response = await request(app)
      .get("/api/admin/blocked-logins")
      .set("Cookie", [`token=${token}`])
      .expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty("attemptCount");
    expect(response.body).toHaveProperty("recent");
  });
});
