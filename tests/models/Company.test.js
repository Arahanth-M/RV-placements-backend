import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import { COMPANY_VISIT_YEAR } from "../../services/companyService.js";

describe("CompanyStatic + CompanyVisit (split schema)", () => {
  beforeEach(async () => {
    await CompanyVisit.deleteMany({});
    await CompanyStatic.deleteMany({});
  });

  it("should create a static row and optional visit for approved flow", async () => {
    const s = await CompanyStatic.create({
      name: "Acme",
      nameKey: "acme",
      business_model: "B2C",
    });
    const v = await CompanyVisit.create({
      companyId: s._id,
      year: COMPANY_VISIT_YEAR,
      status: "approved",
      type: "FTE",
    });
    expect(s._id).toBeDefined();
    expect(v._id).toBeDefined();
    expect(String(v.companyId)).toBe(String(s._id));
  });

  it("should fail CompanyStatic when nameKey duplicate", async () => {
    await CompanyStatic.create({ name: "A", nameKey: "a" });
    await expect(
      CompanyStatic.create({ name: "A2", nameKey: "a" })
    ).rejects.toThrow();
  });

  it("should find visit by company and year", async () => {
    const s = await CompanyStatic.create({ name: "B", nameKey: "b" });
    await CompanyVisit.create({
      companyId: s._id,
      year: COMPANY_VISIT_YEAR,
      status: "pending",
    });
    const found = await CompanyVisit.findOne({
      companyId: s._id,
      year: COMPANY_VISIT_YEAR,
    });
    expect(found?.status).toBe("pending");
  });
});
