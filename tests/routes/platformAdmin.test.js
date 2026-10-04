import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../server.js";
import { config } from "../../config/constants.js";
import User1 from "../../models/User1.js";

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

  it("lists visitors newest login first for a platform owner", async () => {
    await User1.create([
      {
        email: "early@gmail.com",
        username: "Early",
        googleId: "g-early",
        lastLoginAt: new Date("2026-09-30T12:00:00.000Z"),
      },
      {
        email: "late@gmail.com",
        username: "Late",
        googleId: "g-late",
        lastLoginAt: new Date("2026-10-03T15:30:00.000Z"),
      },
      {
        email: "student@rvce.edu.in",
        username: "Campus",
        googleId: "g-campus",
        lastLoginAt: new Date("2026-10-01T04:30:00.000Z"),
      },
    ]);

    const token = signAdmin({
      email: "owner@gmail.com",
      adminScope: "platform",
      isSuperAdmin: true,
    });
    const response = await request(app)
      .get("/api/admin/platform/visitors")
      .set("Cookie", [`token=${token}`])
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items.map((row) => row.email)).toEqual([
      "late@gmail.com",
      "student@rvce.edu.in",
    ]);
    expect(response.body.items[0]).toMatchObject({
      username: "Late",
      audience: "general",
      lastLoginAt: "2026-10-03T15:30:00.000Z",
    });
    expect(response.body.items[1].audience).toBe("campus");

    const search = await request(app)
      .get("/api/admin/platform/visitors")
      .query({ q: "late" })
      .set("Cookie", [`token=${token}`])
      .expect(200);
    expect(search.body.items.map((row) => row.email)).toEqual(["late@gmail.com"]);
  });
});
