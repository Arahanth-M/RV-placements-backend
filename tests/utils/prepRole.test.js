import { describe, expect, it } from "@jest/globals";
import {
  GENERAL_PREP_ROLE_KEY,
  normalizePrepRoleKey,
  prepRoleCatalogMissing,
  prepRoleScopedKey,
} from "../../utils/prepRole.js";

describe("prepRole utils", () => {
  it("normalizes empty role to General", () => {
    expect(normalizePrepRoleKey("")).toEqual({
      key: GENERAL_PREP_ROLE_KEY,
      label: "General",
    });
  });

  it("slugifies role labels into stable keys", () => {
    expect(normalizePrepRoleKey("Software Engineer")).toEqual({
      key: "software-engineer",
      label: "Software Engineer",
    });
  });

  it("scopes dedupe keys by role", () => {
    const a = prepRoleScopedKey("sde", "question-one");
    const b = prepRoleScopedKey("", "question-one");
    expect(a).not.toEqual(b);
  });

  it("detects missing catalog entries", () => {
    expect(prepRoleCatalogMissing([], { key: "sde", label: "SDE" })).toBe(true);
    expect(
      prepRoleCatalogMissing([{ key: "sde", label: "SDE" }], { key: "sde", label: "SDE" })
    ).toBe(false);
  });
});
