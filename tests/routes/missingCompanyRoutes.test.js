import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../../server.js";
import Company from "../../models/Company.js";
import MissingCompany from "../../models/MissingCompany.js";
import User from "../../models/User.js";
import { buildJwtPayloadFromUser } from "../../utils/jwtUserClaims.js";

const STUDENT_COLLECTION = "betaTestUsers2026";

function authCookieForUser(user, options = {}) {
  const secret = process.env.JWT_SECRET;
  const payload = buildJwtPayloadFromUser(user, options);
  const token = jwt.sign(payload, secret, { expiresIn: "1h" });
  return `token=${token}`;
}

describe("Missing Company Routes", () => {
  describe("POST /api/missing-companies", () => {
    it("allows a beta user to submit a missing company request", async () => {
      const user = await User.create({
        userId: "beta-user-1",
        username: "beta_user",
        email: "beta1@example.com",
        isBetaListed: true,
      });

      await mongoose.connection.db.collection(STUDENT_COLLECTION).insertOne({
        Email: "beta1@example.com",
        "FTE Company name": "Atlassian",
      });

      const response = await request(app)
        .post("/api/missing-companies")
        .set("Cookie", authCookieForUser(user))
        .send({
          companyName: "Atlassian",
          category: "FTE",
        })
        .expect(200);

      expect(response.body.message).toBe("Missing company request submitted successfully");
      expect(response.body.missingCompany).toMatchObject({
        name: "Atlassian",
        normalizedName: "atlassian",
        requestCount: 1,
        status: "PENDING",
      });

      const saved = await MissingCompany.findOne({ normalizedName: "atlassian" }).lean();
      expect(saved).not.toBeNull();
      expect(saved.requestedBy).toHaveLength(1);
      expect(String(saved.requestedBy[0])).toBe(String(user._id));
      expect(saved.categories).toContain("FTE");
    });

    it("blocks non-beta users at the backend level", async () => {
      const user = await User.create({
        userId: "non-beta-user-1",
        username: "non_beta_user",
        email: "nonbeta@example.com",
        isBetaListed: false,
      });

      await request(app)
        .post("/api/missing-companies")
        .set("Cookie", authCookieForUser(user))
        .send({
          companyName: "Atlassian",
          category: "FTE",
        })
        .expect(403);
    });

    it("rejects companies that already exist in companies1", async () => {
      const user = await User.create({
        userId: "beta-user-2",
        username: "beta_user_2",
        email: "beta2@example.com",
        isBetaListed: true,
      });

      await mongoose.connection.db.collection(STUDENT_COLLECTION).insertOne({
        Email: "beta2@example.com",
        "FTE Company name": "Google",
      });

      await Company.create({
        name: "Google",
        type: "FTE",
        status: "approved",
      });

      const response = await request(app)
        .post("/api/missing-companies")
        .set("Cookie", authCookieForUser(user))
        .send({
          companyName: "Google",
          category: "FTE",
        })
        .expect(400);

      expect(response.body.error).toBe("Company already exists");
      expect(await MissingCompany.countDocuments()).toBe(0);
    });
  });

  describe("Admin missing company moderation", () => {
    it("lists missing companies sorted by requestCount desc", async () => {
      const admin = await User.create({
        userId: "admin-user-1",
        username: "admin_user",
        email: "admin@example.com",
        role: "admin",
      });

      await MissingCompany.create([
        {
          name: "Company Low",
          normalizedName: "company low",
          requestCount: 2,
          status: "PENDING",
        },
        {
          name: "Company High",
          normalizedName: "company high",
          requestCount: 7,
          status: "PENDING",
        },
      ]);

      const response = await request(app)
        .get("/api/admin/missing-companies")
        .set("Cookie", authCookieForUser(admin, { isAdminSession: true }))
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0].normalizedName).toBe("company high");
      expect(response.body.items[1].normalizedName).toBe("company low");
    });

    it("updates missing company status", async () => {
      const admin = await User.create({
        userId: "admin-user-2",
        username: "admin_user_2",
        email: "admin2@example.com",
        role: "admin",
      });

      const missingCompany = await MissingCompany.create({
        name: "Canva",
        normalizedName: "canva",
        status: "PENDING",
      });

      const response = await request(app)
        .patch(`/api/admin/missing-companies/${missingCompany._id}/status`)
        .set("Cookie", authCookieForUser(admin, { isAdminSession: true }))
        .send({ status: "ADDED" })
        .expect(200);

      expect(response.body.missingCompany.status).toBe("ADDED");

      const updated = await MissingCompany.findById(missingCompany._id).lean();
      expect(updated.status).toBe("ADDED");
    });

    it("deletes a missing company request", async () => {
      const admin = await User.create({
        userId: "admin-user-3",
        username: "admin_user_3",
        email: "admin3@example.com",
        role: "admin",
      });

      const missingCompany = await MissingCompany.create({
        name: "Figma",
        normalizedName: "figma",
        status: "PENDING",
      });

      await request(app)
        .delete(`/api/admin/missing-companies/${missingCompany._id}`)
        .set("Cookie", authCookieForUser(admin, { isAdminSession: true }))
        .expect(200);

      expect(await MissingCompany.findById(missingCompany._id)).toBeNull();
    });
  });
});
