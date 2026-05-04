import {
  normalizeHeaderLabel,
  resolveStudentBatchColumnMap,
  validateStudentBatchRow,
  STUDENT_BATCH_HEADER_ALIASES,
} from "../../services/studentBatchImportService.js";

describe("studentBatchImportService", () => {
  describe("normalizeHeaderLabel", () => {
    it("trims and lowercases", () => {
      expect(normalizeHeaderLabel("  Email ID  ")).toBe("email id");
    });
  });

  describe("resolveStudentBatchColumnMap", () => {
    it("maps human headers to column indices", () => {
      const header = ["Name", "Email ID", "USN", "Phone", "Branch"];
      const map = resolveStudentBatchColumnMap(header);
      expect(map.name).toBe(0);
      expect(map.email).toBe(1);
      expect(map.usn).toBe(2);
      expect(map.phoneNumber).toBe(3);
      expect(map.branch).toBe(4);
    });

    it("supports alternate labels", () => {
      const header = ["Student Name", "Mail", "Reg No", "Mobile", "Department"];
      const map = resolveStudentBatchColumnMap(header);
      expect(map.name).toBe(0);
      expect(map.email).toBe(1);
      expect(map.usn).toBe(2);
      expect(map.phoneNumber).toBe(3);
      expect(map.branch).toBe(4);
    });

    it("throws when a required column is missing", () => {
      expect(() => resolveStudentBatchColumnMap(["Name", "Email"])).toThrow("MISSING_REQUIRED_COLUMNS");
    });
  });

  describe("validateStudentBatchRow", () => {
    it("accepts a valid row", () => {
      expect(validateStudentBatchRow({ name: "A", email: "a@b.co", usn: "1RV22CS001" })).toEqual([]);
    });

    it("reports missing and invalid fields", () => {
      const r = validateStudentBatchRow({ name: "", email: "not-an-email", usn: "" });
      expect(r.length).toBeGreaterThan(0);
      expect(r.some((x) => x.includes("Name"))).toBe(true);
      expect(r.some((x) => x.includes("email"))).toBe(true);
      expect(r.some((x) => x.includes("USN"))).toBe(true);
    });
  });

  it("documents at least one alias per schema field", () => {
    for (const key of ["name", "email", "usn", "phoneNumber", "branch"]) {
      expect(Array.isArray(STUDENT_BATCH_HEADER_ALIASES[key])).toBe(true);
      expect(STUDENT_BATCH_HEADER_ALIASES[key].length).toBeGreaterThan(0);
    }
  });
});
