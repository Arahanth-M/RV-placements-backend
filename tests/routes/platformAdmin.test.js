import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../server.js";
import { config } from "../../config/constants.js";

function signAdmin(claims) {
  return jwt.sign(
    {
      userId: "admin-google",
      _id: "507f1f77bcf86cd799439011",
      email: "placement@rvce.edu.in",
      role: "admin",
      isAdminSession: true,
      ...claims,
    },
    config.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

describe("platform admin routes", () => {
  it("rejects an unauthenticated stats request", async () => {
    await request(app).get("/api/admin/platform/stats").expect(401);
  });

  it("rejects a campus admin JWT", async () => {
    const token = signAdmin({ adminScope: "campus", isSuperAdmin: false });
    const response = await request(app)
      .get("/api/admin/platform/stats")
      .set("Cookie", [`token=${token}`])
      .expect(403);
    expect(response.body.error).toMatch(/platform admin/i);
  });

  it("returns stats for a platform owner JWT", async () => {
    const token = signAdmin({
      email: "owner@gmail.com",
      adminScope: "platform",
      isSuperAdmin: true,
    });
    const response = await request(app)
      .get("/api/admin/platform/stats")
      .set("Cookie", [`token=${token}`])
      .expect(200);
    expect(response.body).toHaveProperty("totalUsers");
    expect(response.body).toHaveProperty("pendingSubmissions");
    expect(response.body).toHaveProperty("onboardingOpen");
  });
});
