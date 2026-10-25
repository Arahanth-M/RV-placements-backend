import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

describe("production login lock", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      PLATFORM_OWNER_EMAILS: "owner@gmail.com",
      JWT_SECRET: originalEnv.JWT_SECRET || "test-jwt-secret-for-jest",
      DEBUG_JWT_AUTH: "0",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("allows every email outside production", async () => {
    process.env.NODE_ENV = "test";
    const { productionLoginAllowed, PRODUCTION_LOGIN_MESSAGE } = await import(
      "../../utils/productionLoginLock.js"
    );
    expect(PRODUCTION_LOGIN_MESSAGE).toBe("Login through ur official college emailId");
    expect(productionLoginAllowed("student@rvce.edu.in")).toBe(true);
    expect(productionLoginAllowed("owner@gmail.com")).toBe(true);
  });

  it("allows every email on localhost", async () => {
    process.env.NODE_ENV = "development";
    const { productionLoginAllowed } = await import("../../utils/productionLoginLock.js");
    expect(productionLoginAllowed("owner@gmail.com")).toBe(true);
    expect(productionLoginAllowed("student@rvce.edu.in")).toBe(true);
  });

  it("allows every email in production", async () => {
    process.env.NODE_ENV = "production";
    const { productionLoginAllowed } = await import("../../utils/productionLoginLock.js");
    expect(productionLoginAllowed("owner@gmail.com")).toBe(true);
    expect(productionLoginAllowed("OWNER@gmail.com")).toBe(true);
    expect(productionLoginAllowed("student@rvce.edu.in")).toBe(true);
    expect(productionLoginAllowed("campus@rvce.edu.in")).toBe(true);
  });

  it("keeps an existing student session in production", async () => {
    process.env.NODE_ENV = "production";
    const authJWT = (await import("../../middleware/authJWT.js")).default;
    const token = jwt.sign(
      {
        userId: "google-student",
        email: "student@rvce.edu.in",
        _id: "507f1f77bcf86cd799439011",
      },
      process.env.JWT_SECRET
    );
    const req = { cookies: { token }, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      clearCookie: jest.fn(),
    };
    const next = jest.fn();

    await authJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("keeps the platform admin session in production", async () => {
    process.env.NODE_ENV = "production";
    const authJWT = (await import("../../middleware/authJWT.js")).default;
    const token = jwt.sign(
      {
        userId: "google-owner",
        email: "owner@gmail.com",
        _id: "507f1f77bcf86cd799439012",
      },
      process.env.JWT_SECRET
    );
    const req = { cookies: { token }, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      clearCookie: jest.fn(),
    };
    const next = jest.fn();

    await authJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
