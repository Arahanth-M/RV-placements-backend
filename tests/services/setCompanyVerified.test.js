import CompanyStatic from "../../models/CompanyStatic.js";
import { setCompanyVerified } from "../../services/platformCompanyMutationsService.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("setCompanyVerified", () => {
  it("marks a company verified with notes and exposes them on platform detail", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Verified Toggle Co",
    });
    const companyId = String(staticRow._id);

    const out = await setCompanyVerified(companyId, {
      verified: true,
      notes: "OA + interview reviewed",
    });
    expect(out.verified).toBe(true);
    expect(out.verifiedAt).toBeTruthy();
    expect(out.verifiedNotes).toBe("OA + interview reviewed");

    const saved = await CompanyStatic.findById(companyId).lean();
    expect(saved.verified).toBe(true);
    expect(saved.verifiedNotes).toBe("OA + interview reviewed");

    const payload = await getCompanyPlatformDetailById(companyId);
    expect(payload.verified).toBe(true);
    expect(payload.verifiedNotes).toBe("OA + interview reviewed");
  });

  it("can update notes without changing verified", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Notes Only Co",
    });
    const companyId = String(staticRow._id);
    await setCompanyVerified(companyId, { verified: true, notes: "first" });
    const out = await setCompanyVerified(companyId, { notes: "updated note" });
    expect(out.verified).toBe(true);
    expect(out.verifiedNotes).toBe("updated note");
  });

  it("can clear verification while keeping notes", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Unverify Toggle Co",
    });
    const companyId = String(staticRow._id);
    await setCompanyVerified(companyId, {
      verified: true,
      notes: "keep me",
    });
    const out = await setCompanyVerified(companyId, { verified: false });
    expect(out.verified).toBe(false);
    expect(out.verifiedAt).toBeNull();
    expect(out.verifiedNotes).toBe("keep me");
  });

  it("rejects empty payload", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Bad Verified Payload Co",
    });
    await expect(
      setCompanyVerified(String(staticRow._id), {})
    ).rejects.toMatchObject({ status: 400 });
  });
});
