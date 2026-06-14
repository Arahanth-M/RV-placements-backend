import {
  parseVisitDateToTimestamp,
  companyVisitSortTimestamp,
} from "../../utils/visitDateSort.js";

const Y2026 = { defaultYear: 2026 };

describe("visitDateSort", () => {
  describe("parseVisitDateToTimestamp", () => {
    it("parses ISO and ordinal single dates", () => {
      expect(parseVisitDateToTimestamp("2026-09-15")).toBe(
        new Date(2026, 8, 15).getTime()
      );
      expect(parseVisitDateToTimestamp("18th October 2026")).toBe(
        new Date(2026, 9, 18).getTime()
      );
    });

    it("parses visit date ranges using the range start day", () => {
      expect(parseVisitDateToTimestamp("13-18th October", Y2026)).toBe(
        new Date(2026, 9, 13).getTime()
      );
      expect(parseVisitDateToTimestamp("13 to 18 October 2026")).toBe(
        new Date(2026, 9, 13).getTime()
      );
    });

    it("parses fuzzy month phrases", () => {
      expect(parseVisitDateToTimestamp("mid September", Y2026)).toBe(
        new Date(2026, 8, 15).getTime()
      );
      expect(parseVisitDateToTimestamp("early September", Y2026)).toBe(
        new Date(2026, 8, 7).getTime()
      );
      expect(parseVisitDateToTimestamp("late October", Y2026)).toBe(
        new Date(2026, 9, 22).getTime()
      );
    });

    it("orders April 2026, then mid September, then October ranges", () => {
      const april = parseVisitDateToTimestamp("April 2026", Y2026);
      const september = parseVisitDateToTimestamp("mid September", Y2026);
      const october = parseVisitDateToTimestamp("13-18th October", Y2026);
      expect(april).not.toBeNull();
      expect(september).not.toBeNull();
      expect(october).not.toBeNull();
      expect(april).toBeLessThan(september);
      expect(september).toBeLessThan(october);
    });

    it("sorts by full calendar year, not month alone", () => {
      const april2025 = parseVisitDateToTimestamp("April 2025", Y2026);
      const sept2025 = parseVisitDateToTimestamp("mid September 2025", Y2026);
      const april2026 = parseVisitDateToTimestamp("April 2026", Y2026);
      const oct2026 = parseVisitDateToTimestamp("13-18th October 2026", Y2026);
      expect(april2025).toBeLessThan(sept2025);
      expect(sept2025).toBeLessThan(april2026);
      expect(april2026).toBeLessThan(oct2026);
    });

    it("uses placementVisitYear when date text has no year", () => {
      const ts = companyVisitSortTimestamp(
        {
          date_of_visit: "mid September",
          placementVisitYear: 2025,
        },
        Y2026
      );
      expect(ts).toBe(new Date(2025, 8, 15).getTime());
    });

    it("handles common admin variants", () => {
      expect(parseVisitDateToTimestamp("Mid September", Y2026)).toBe(
        new Date(2026, 8, 15).getTime()
      );
      expect(parseVisitDateToTimestamp("13 - 18th Oct", Y2026)).toBe(
        new Date(2026, 9, 13).getTime()
      );
      expect(parseVisitDateToTimestamp("first week of September", Y2026)).toBe(
        new Date(2026, 8, 4).getTime()
      );
      expect(parseVisitDateToTimestamp("late Sept", Y2026)).toBe(
        new Date(2026, 8, 22).getTime()
      );
    });

    it("returns null for placeholders", () => {
      expect(parseVisitDateToTimestamp("TBA")).toBeNull();
      expect(parseVisitDateToTimestamp("to be decided")).toBeNull();
    });
  });

  describe("companyVisitSortTimestamp", () => {
    it("sorts only from date_of_visit, not messageDate", () => {
      const withVisit = companyVisitSortTimestamp(
        {
          date_of_visit: "mid September",
          messageDate: "2026-11-01",
        },
        Y2026
      );
      expect(withVisit).toBe(new Date(2026, 8, 15).getTime());

      const withoutVisit = companyVisitSortTimestamp(
        {
          date_of_visit: "",
          messageDate: "2026-04-01",
        },
        Y2026
      );
      expect(withoutVisit).toBeNull();
    });

    it("uses hub-specific dream and summer dates for sorting", () => {
      const dreamTs = companyVisitSortTimestamp(
        {
          date_of_visit: "mid September",
          placementDreamDateOfVisit: "April 2026",
          placementDreamDetailYear: 2026,
          placementVisitYear: 2027,
        },
        { defaultYear: 2026, hub: "dream" }
      );
      expect(dreamTs).toBe(new Date(2026, 3, 15).getTime());

      const summerTs = companyVisitSortTimestamp(
        {
          date_of_visit: "April 2026",
          placementSummerDateOfVisit: "mid September",
          placementSummerDetailYear: 2026,
        },
        { defaultYear: 2026, hub: "summer_internship" }
      );
      expect(summerTs).toBe(new Date(2026, 8, 15).getTime());
    });
  });
});
