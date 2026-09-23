import { describe, it, expect } from "@jest/globals";
import { buildJwtPayloadFromUser } from "../../utils/jwtUserClaims.js";

describe("buildJwtPayloadFromUser previousLastLoginAt", () => {
  const user = {
    _id: "507f1f77bcf86cd799439011",
    googleId: "google-1",
    email: "student@rvce.edu.in",
    username: "Student",
    role: "student",
    points: 0,
  };

  it("omits previousLastLoginAt by default so existing tokens stay unchanged", () => {
    const payload = buildJwtPayloadFromUser(user);
    expect(payload.previousLastLoginAt).toBeUndefined();
    expect(payload.email).toBe("student@rvce.edu.in");
    expect(payload.role).toBe("student");
  });

  it("adds previousLastLoginAt for student sessions only", () => {
    const previous = "2026-08-20T10:15:00.000Z";
    const payload = buildJwtPayloadFromUser(user, {
      previousLastLoginAt: previous,
    });
    expect(payload.previousLastLoginAt).toBe(previous);
  });

  it("does not add previousLastLoginAt on admin sessions", () => {
    const payload = buildJwtPayloadFromUser(user, {
      isAdminSession: true,
      adminScope: "campus",
      previousLastLoginAt: "2026-08-20T10:15:00.000Z",
    });
    expect(payload.isAdminSession).toBe(true);
    expect(payload.isSuperAdmin).toBe(false);
    expect(payload.adminScope).toBe("campus");
    expect(payload.previousLastLoginAt).toBeUndefined();
  });

  it("marks platform owners as super admins", () => {
    const payload = buildJwtPayloadFromUser(user, {
      isAdminSession: true,
      adminScope: "platform",
    });
    expect(payload.isSuperAdmin).toBe(true);
    expect(payload.adminScope).toBe("platform");
  });
});
