import { jest } from "@jest/globals";

const mockGetCompanyMergedForAdminById = jest.fn();

jest.unstable_mockModule("../../services/companyService.js", () => ({
  getCompanyMergedForAdminById: mockGetCompanyMergedForAdminById,
}));

const { resolveInterviewCompanyName } = await import(
  "../../services/interviewSessionService.js"
);

describe("resolveInterviewCompanyName", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the populated company name when it is already present", async () => {
    const result = await resolveInterviewCompanyName({
      companyId: { _id: "abc123", name: "Google" },
    });

    expect(result).toBe("Google");
    expect(mockGetCompanyMergedForAdminById).not.toHaveBeenCalled();
  });

  it("falls back to the company service when only a raw company id exists", async () => {
    mockGetCompanyMergedForAdminById.mockResolvedValue({
      merged: { name: "Atlassian" },
      staticRow: { name: "Atlassian" },
      visit: null,
    });

    const result = await resolveInterviewCompanyName({
      companyId: "507f1f77bcf86cd799439011",
      companyName: "Unknown Company",
    });

    expect(result).toBe("Atlassian");
    expect(mockGetCompanyMergedForAdminById).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439011"
    );
  });

  it("returns the fallback when the company cannot be resolved", async () => {
    mockGetCompanyMergedForAdminById.mockResolvedValue({
      merged: null,
      staticRow: null,
      visit: null,
    });

    const result = await resolveInterviewCompanyName({
      companyId: "507f1f77bcf86cd799439011",
    });

    expect(result).toBe("Unknown Company");
  });
});
