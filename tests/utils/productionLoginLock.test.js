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

  it("allows only the platform admin email on localhost", async () => {
    process.env.NODE_ENV = "development";
    const { productionLoginAllowed } = await import("../../utils/productionLoginLock.js");
    expect(productionLoginAllowed("owner@gmail.com")).toBe(true);
    expect(productionLoginAllowed("student@rvce.edu.in")).toBe(false);
  });

  it("allows only the platform admin email in production", async () => {
    process.env.NODE_ENV = "production";
    const { productionLoginAllowed } = await import("../../utils/productionLoginLock.js");
    expect(productionLoginAllowed("owner@gmail.com")).toBe(true);
    expect(productionLoginAllowed("OWNER@gmail.com")).toBe(true);
    expect(productionLoginAllowed("student@rvce.edu.in")).toBe(false);
    expect(productionLoginAllowed("campus@rvce.edu.in")).toBe(false);
  });

  it("rejects an existing session for any other email in production", async () => {
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

    authJWT(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith("token", { path: "/" });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Login through ur official college emailId",
    });
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

    authJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
