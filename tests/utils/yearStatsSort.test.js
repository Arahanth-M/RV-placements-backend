import { describe, expect, it } from "@jest/globals";
import {
  findYearStatsSerialFieldKey,
  parseYearStatsSerialNumber,
  sortYearStatsRows,
} from "../../utils/yearStatsSort.js";

describe("yearStatsSort", () => {
  it("detects Sl. No style column names", () => {
    expect(findYearStatsSerialFieldKey({ "Sl. No": 1, company: "A" })).toBe("Sl. No");
    expect(findYearStatsSerialFieldKey({ "SL NO": 2 })).toBe("SL NO");
    expect(findYearStatsSerialFieldKey({ sl_no: 3 })).toBe("sl_no");
  });

  it("parses numeric serial values", () => {
    expect(parseYearStatsSerialNumber(12)).toBe(12);
    expect(parseYearStatsSerialNumber("15")).toBe(15);
    expect(parseYearStatsSerialNumber("  7 ")).toBe(7);
  });

  it("sorts rows ascending by serial column", () => {
    const rows = [
      { "Sl. No": 3, company: "C" },
      { "Sl. No": 1, company: "A" },
      { "Sl. No": 2, company: "B" },
    ];
    const sorted = sortYearStatsRows(rows);
    expect(sorted.map((r) => r.company)).toEqual(["A", "B", "C"]);
  });

  it("leaves rows unchanged when no serial column exists", () => {
    const rows = [{ company: "B" }, { company: "A" }];
    expect(sortYearStatsRows(rows)).toEqual(rows);
  });
});
