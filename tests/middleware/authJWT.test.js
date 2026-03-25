import { describe, it, expect, jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import authJWT from "../../middleware/authJWT.js";

describe("authJWT middleware", () => {
  const secret = process.env.JWT_SECRET;

  it("verifies JWT and attaches claims to req.user (no DB)", () => {
    const payload = {
      userId: "google-test-id",
      email: "test@rvce.edu.in",
      _id: "507f1f77bcf86cd799439011",
      username: "Test User",
      picture: "https://example.com/p.png",
      fillForm: false,
      points: 0,
      isPremium: false,
      createdAt: new Date().toISOString(),
    };
    const token = jwt.sign(payload, secret, { expiresIn: "1h" });

    const req = { cookies: { token }, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    authJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user.userId).toBe(payload.userId);
    expect(req.user.email).toBe(payload.email);
    expect(req.user._id).toBe(payload._id);
  });

  it("accepts Bearer token when cookie absent", () => {
    const payload = {
      userId: "google-test-id-2",
      email: "test2@rvce.edu.in",
      _id: "507f1f77bcf86cd799439012",
      username: "T2",
      fillForm: false,
      points: 0,
      isPremium: false,
      createdAt: new Date().toISOString(),
    };
    const token = jwt.sign(payload, secret, { expiresIn: "1h" });

    const req = {
      cookies: {},
      headers: { authorization: `Bearer ${token}` },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    authJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe(payload.userId);
  });

  it("returns 401 when token missing userId", () => {
    const token = jwt.sign({ email: "a@b.com", _id: "507f1f77bcf86cd799439011" }, secret, {
      expiresIn: "1h",
    });
    const req = { cookies: { token }, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    authJWT(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("logs debug lines when DEBUG_JWT_AUTH is enabled", () => {
    const prev = process.env.DEBUG_JWT_AUTH;
    process.env.DEBUG_JWT_AUTH = "true";

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const payload = {
      userId: "log-user",
      email: "log@rvce.edu.in",
      _id: "507f1f77bcf86cd799439013",
      username: "L",
      fillForm: false,
      points: 0,
      isPremium: false,
      createdAt: new Date().toISOString(),
    };
    const token = jwt.sign(payload, secret, { expiresIn: "1h" });
    const req = { cookies: { token }, headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    authJWT(req, res, next);

    expect(logSpy).toHaveBeenCalledWith("token received");
    expect(logSpy).toHaveBeenCalledWith("token verified");
    expect(logSpy).toHaveBeenCalledWith("userId extracted:", "log-user");

    logSpy.mockRestore();
    process.env.DEBUG_JWT_AUTH = prev;
  });
});
