import {
  mergeSpcOfferIntoVisitRoles,
  mergeCompensationField,
  allCompensationPlaceholder,
  collapseRoleCtcKeyAliases,
  compensationRupeesClose,
  compensationValuesClose,
  submissionCloseToVisitCompensation,
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

  describe("compensationRupeesClose", () => {
    it("is within ±5 LPA only", () => {
      expect(compensationRupeesClose(1_000_000, 1_400_000)).toBe(true);
      expect(compensationRupeesClose(1_000_000, 1_600_000)).toBe(false);
      expect(compensationRupeesClose(1_000_000, 1_500_000)).toBe(true);
    });
  });

  describe("compensationValuesClose", () => {
    it("treats blank or TBD existing as close", () => {
      expect(compensationValuesClose("TBD", "12 LPA")).toBe(true);
      expect(compensationValuesClose("", "12 LPA")).toBe(true);
    });
  });

  describe("mergeSpcOfferIntoVisitRoles", () => {
    const sdeRow = {
      roleName: "SDE",
      ctc: { CTC: "12 LPA", Base: "10 LPA" },
      internshipStipend: 50000,
    };

    it("case 6: all TBD leaves roles unchanged", () => {
      const out = mergeSpcOfferIntoVisitRoles([sdeRow], {
        roleName: "TBD",
        ctcStr: "TBD",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toEqual([sdeRow]);
    });

    it("case 2: same role updates fields (case 5 keeps base when TBD submitted)", () => {
      const out = mergeSpcOfferIntoVisitRoles([sdeRow], {
        roleName: "SDE",
        ctcStr: "13 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(1);
      expect(out[0].ctc.CTC).toBe("13 LPA");
      expect(out[0].ctc.Base).toBe("10 LPA");
    });

    it("case 1: appends new role when another concrete role exists even if comp is close", () => {
      const out = mergeSpcOfferIntoVisitRoles([sdeRow], {
        roleName: "Analyst",
        ctcStr: "12.5 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.roleName).sort()).toEqual(["Analyst", "SDE"]);
    });

    it("case 1: overwrites TBD row when comp close and no other concrete role", () => {
      const visit = [{ roleName: "TBD", ctc: { CTC: "TBD" } }];
      const out = mergeSpcOfferIntoVisitRoles(visit, {
        roleName: "Analyst",
        ctcStr: "12 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(1);
      expect(out[0].roleName).toBe("Analyst");
      expect(out[0].ctc.CTC).toBe("12 LPA");
    });

    it("case 1: appends when comp far from numeric already on card", () => {
      const out = mergeSpcOfferIntoVisitRoles([sdeRow, { roleName: "TBD", ctc: { CTC: "TBD" } }], {
        roleName: "Analyst",
        ctcStr: "25 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(3);
      expect(out.map((r) => r.roleName)).toEqual(
        expect.arrayContaining(["SDE", "TBD", "Analyst"])
      );
    });

    it("case 3: TBD role close overwrites TBD row; far adds second TBD row", () => {
      const close = mergeSpcOfferIntoVisitRoles([{ roleName: "TBD", ctc: { CTC: "10 LPA" } }], {
        roleName: "TBD",
        ctcStr: "12 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(close).toHaveLength(1);
      expect(close[0].ctc.CTC).toBe("12 LPA");

      const far = mergeSpcOfferIntoVisitRoles([{ roleName: "TBD", ctc: { CTC: "10 LPA" } }], {
        roleName: "TBD",
        ctcStr: "25 LPA",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(far).toHaveLength(2);
      expect(far.map((r) => r.roleName)).toEqual(["TBD", "TBD"]);
      expect(far[0].ctc.CTC).toBe("10 LPA");
      expect(far[1].ctc.CTC).toBe("25 LPA");
    });

    it("case 4: new concrete role with TBD comp appends role only", () => {
      const out = mergeSpcOfferIntoVisitRoles([sdeRow], {
        roleName: "QA",
        ctcStr: "TBD",
        baseStr: "TBD",
        stipendStr: "TBD",
      });
      expect(out).toHaveLength(2);
      expect(out.find((r) => r.roleName === "QA")?.ctc).toEqual({});
    });

    it("collapses legacy lowercase ctc key on overwrite", () => {
      const out = mergeSpcOfferIntoVisitRoles(
        [{ roleName: "SDE", ctc: { ctc: "10 LPA" } }],
        { roleName: "SDE", ctcStr: "10.5 LPA", baseStr: "TBD", stipendStr: "TBD" }
      );
      expect(Object.keys(out[0].ctc)).toEqual(["CTC"]);
    });
  });

  describe("submissionCloseToVisitCompensation", () => {
    it("detects ±5 LPA against numeric values on the card only", () => {
      const roles = [{ roleName: "SDE", ctc: { CTC: "12 LPA" }, internshipStipend: 0 }];
      expect(
        submissionCloseToVisitCompensation(roles, {
          ctcStr: "13 LPA",
          baseStr: "TBD",
          stipendStr: "TBD",
        })
      ).toBe(true);
      expect(
        submissionCloseToVisitCompensation(roles, {
          ctcStr: "25 LPA",
          baseStr: "TBD",
          stipendStr: "TBD",
        })
      ).toBe(false);
      expect(
        submissionCloseToVisitCompensation([{ roleName: "TBD", ctc: { CTC: "TBD" } }], {
          ctcStr: "12 LPA",
          baseStr: "TBD",
          stipendStr: "TBD",
        })
      ).toBe(false);
    });
  });

  describe("collapseRoleCtcKeyAliases", () => {
    it("merges CTC, Ctc, and ctc into one CTC key", () => {
      expect(collapseRoleCtcKeyAliases({ ctc: "10 LPA" })).toEqual({ CTC: "10 LPA" });
    });
  });
});
