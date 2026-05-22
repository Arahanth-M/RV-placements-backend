import {
  mergeSpcOfferIntoVisitRoles,
  mergeCompensationField,
  allCompensationPlaceholder,
  collapseRoleCtcKeyAliases,
  compensationRupeesClose,
} from "../../services/spcCompensationMerge.js";

describe("spcCompensationMerge", () => {
  describe("mergeCompensationField (case 5)", () => {
    it("does not overwrite numeric CTC with TBD", () => {
      expect(mergeCompensationField("12 LPA", "TBD")).toBe("12 LPA");
    });

    it("fills placeholder with submitted value", () => {
      expect(mergeCompensationField("TBD", "14 LPA")).toBe("14 LPA");
    });
  });

  describe("mergeSpcOfferIntoVisitRoles", () => {
    const baseVisit = [
      {
        roleName: "SDE",
        ctc: { CTC: "12 LPA", Base: "10 LPA" },
        internshipStipend: 50000,
      },
    ];

    it("case 6: all TBD leaves roles unchanged", () => {
      const out = mergeSpcOfferIntoVisitRoles(baseVisit, {
        roleName: "TBD",
        ctcStr: "TBD",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toEqual(baseVisit);
    });

    it("collapses legacy lowercase ctc key on overwrite (no duplicate CTC tiles)", () => {
      const out = mergeSpcOfferIntoVisitRoles(
        [{ roleName: "SDE", ctc: { ctc: "10 LPA" } }],
        { roleName: "SDE", ctcStr: "10.5 LPA", baseStr: "TBD", stipendStr: "TBD" }
      );
      expect(Object.keys(out[0].ctc)).toEqual(["CTC"]);
      expect(out[0].ctc.CTC).toBe("10.5 LPA");
    });

    it("case 2: same role updates fields without dropping row", () => {
      const out = mergeSpcOfferIntoVisitRoles(baseVisit, {
        roleName: "SDE",
        ctcStr: "13 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(1);
      expect(out[0].roleName).toBe("SDE");
      expect(out[0].ctc.CTC).toBe("13 LPA");
      expect(out[0].ctc.Base).toBe("10 LPA");
    });

    it("case 1 far: new role appends when compensation not close", () => {
      const out = mergeSpcOfferIntoVisitRoles(baseVisit, {
        roleName: "Analyst",
        ctcStr: "25 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.roleName)).toEqual(expect.arrayContaining(["SDE", "Analyst"]));
    });

    it("rewrites placeholder role when concrete role submitted", () => {
      const visit = [{ roleName: "TBD", ctc: { CTC: "TBD" } }];
      const out = mergeSpcOfferIntoVisitRoles(visit, {
        roleName: "Data Engineer",
        ctcStr: "TBD",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(1);
      expect(out[0].roleName).toBe("Data Engineer");
    });
  });

  describe("compensationRupeesClose", () => {
    it("uses a 5 LPA absolute band (plus 10% relative)", () => {
      expect(compensationRupeesClose(1_000_000, 1_400_000)).toBe(true);
      expect(compensationRupeesClose(1_000_000, 1_600_000)).toBe(false);
    });
  });

  describe("collapseRoleCtcKeyAliases", () => {
    it("merges CTC, Ctc, and ctc into one CTC key", () => {
      expect(collapseRoleCtcKeyAliases({ ctc: "10 LPA" })).toEqual({ CTC: "10 LPA" });
      expect(collapseRoleCtcKeyAliases({ ctc: "10 LPA", CTC: "11 LPA" })).toEqual({
        CTC: "11 LPA",
      });
    });
  });

  describe("allCompensationPlaceholder", () => {
    it("treats empty and TBD as placeholder", () => {
      expect(allCompensationPlaceholder({ ctcStr: "", baseStr: "TBD", stipendStr: "n/a" })).toBe(
        true
      );
    });
  });
});
