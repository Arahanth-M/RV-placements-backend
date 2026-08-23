import { describe, it, expect } from "@jest/globals";
import {
  formatDauActionLabels,
  normalizeDauAction,
  normalizeDauActions,
} from "../../services/dau/dauActions.js";

describe("normalizeDauAction", () => {
  it("accepts known keys", () => {
    expect(normalizeDauAction("login")).toBe("login");
    expect(normalizeDauAction("prep_path")).toBe("prep_path");
  });

  it("drops unknown keys so callers cannot write junk", () => {
    expect(normalizeDauAction("hacked")).toBe("");
    expect(normalizeDauAction("")).toBe("");
  });
});

describe("formatDauActionLabels", () => {
  it("returns empty for missing actions on legacy rows", () => {
    expect(formatDauActionLabels(undefined)).toEqual([]);
    expect(formatDauActionLabels(null)).toEqual([]);
  });

  it("lists each opened company instead of a generic opened label", () => {
    expect(
      formatDauActionLabels(["login", "opened_company"], ["Google", "Amazon"])
    ).toEqual(["Logged in", "Opened Google", "Opened Amazon"]);
  });

  it("lists PrepPath generations with company names", () => {
    expect(
      formatDauActionLabels(["prep_path"], [], ["Google"])
    ).toEqual(["PrepPath · Google"]);
  });
});

describe("normalizeDauActions", () => {
  it("dedupes", () => {
    expect(normalizeDauActions(["login", "login", "ai_interview"])).toEqual([
      "login",
      "ai_interview",
    ]);
  });
});
