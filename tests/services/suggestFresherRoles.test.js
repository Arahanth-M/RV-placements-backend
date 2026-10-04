import { jest } from "@jest/globals";

const mockSearchWeb = jest.fn();
const mockCallLLM = jest.fn();
const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();

jest.unstable_mockModule("../../services/companyResearch/tavilySearch.js", () => ({
  searchWeb: (...args) => mockSearchWeb(...args),
}));

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
}));

const { selectGroundedFresherRoles, suggestFresherRoles } = await import(
  "../../services/companyResearch/suggestFresherRoles.js"
);

const snippets = [
  {
    title: "Amazon campus hiring",
    snippet: "Amazon hires freshers for SDE and Data Analyst roles in campus placement.",
  },
];

describe("selectGroundedFresherRoles", () => {
  it("keeps fresher titles that appear in the snippets and drops invented ones", () => {
    expect(
      selectGroundedFresherRoles(
        [
          { role: "SDE", source: 0 },
          { role: "Data Analyst", source: 0 },
          { role: "Product Manager", source: 0 },
          { role: "TBD", source: 0 },
        ],
        snippets
      )
    ).toEqual(["SDE", "Data Analyst"]);
  });

  it("does not keep a title that only appears in a different snippet than the one cited", () => {
    expect(
      selectGroundedFresherRoles([{ role: "Data Analyst", source: 1 }], [
        { title: "One", snippet: "Campus roles include SDE." },
        { title: "Two", snippet: "The page talks about benefits." },
      ])
    ).toEqual([]);
  });
});

describe("suggestFresherRoles", () => {
  beforeEach(() => {
    mockSearchWeb.mockReset();
    mockCallLLM.mockReset();
    mockGetJSON.mockReset();
    mockSetJSON.mockReset();
    mockGetJSON.mockResolvedValue(null);
    mockSetJSON.mockResolvedValue(true);
  });

  it("returns a cached list without searching again", async () => {
    mockGetJSON.mockResolvedValue({ roles: ["SDE"] });

    await expect(
      suggestFresherRoles({ companyId: "amazon-id", companyName: "Amazon" })
    ).resolves.toEqual(["SDE"]);

    expect(mockSearchWeb).not.toHaveBeenCalled();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it("extracts only roles named in the public hiring pages", async () => {
    mockSearchWeb.mockResolvedValue([
      {
        title: "Amazon campus hiring",
        url: "https://example.com/amazon",
        snippet: "Amazon hires freshers for SDE and Data Analyst roles in campus placement.",
      },
    ]);
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        roles: [
          { role: "SDE", source: 0 },
          { role: "Data Analyst", source: 0 },
          { role: "Product Manager", source: 0 },
        ],
      })
    );

    await expect(
      suggestFresherRoles({ companyId: "amazon-id", companyName: "Amazon" })
    ).resolves.toEqual(["SDE", "Data Analyst"]);

    expect(mockSearchWeb).toHaveBeenCalled();
    expect(mockSetJSON).toHaveBeenCalledWith(
      expect.stringContaining("amazon-id"),
      { roles: ["SDE", "Data Analyst"] },
      expect.any(Number)
    );
  });

  it("returns no roles when public search fails", async () => {
    mockSearchWeb.mockRejectedValue(new Error("search down"));

    await expect(
      suggestFresherRoles({ companyId: "amazon-id", companyName: "Amazon" })
    ).resolves.toEqual([]);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockSetJSON).not.toHaveBeenCalled();
  });
});
