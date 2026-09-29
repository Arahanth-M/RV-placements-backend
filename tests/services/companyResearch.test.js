import { jest } from "@jest/globals";
import { normalizeSourceUrl } from "../../services/companyResearch/urlNormalize.js";
import {
  normalizeTavilyResults,
  searchWeb,
  TavilySearchError,
} from "../../services/companyResearch/tavilySearch.js";
import {
  extractWebPage,
  FirecrawlExtractError,
  normalizeFirecrawlPayload,
} from "../../services/companyResearch/firecrawlExtract.js";

const mockCallLLM = jest.fn();

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: mockCallLLM,
}));

const { structureInterviewQuestions, StructureInterviewQuestionsError } = await import(
  "../../services/companyResearch/structureWithGroq.js"
);

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

describe("company research clients", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TAVILY_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("rejects Tavily search when the API key is missing", async () => {
    delete process.env.TAVILY_API_KEY;
    global.fetch = jest.fn();
    await expect(searchWeb("acme interview questions")).rejects.toMatchObject({
      name: "TavilySearchError",
      code: "missing_api_key",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects Firecrawl extraction when the API key is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    global.fetch = jest.fn();
    await expect(extractWebPage("https://example.com/page")).rejects.toMatchObject({
      name: "FirecrawlExtractError",
      code: "missing_api_key",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("normalizes Tavily results and drops duplicate URLs", () => {
    const rows = normalizeTavilyResults({
      results: [
        {
          title: "Page",
          url: "https://example.com/page?utm_source=newsletter",
          content: "snippet",
          score: 0.9,
        },
        {
          title: "Duplicate",
          url: "https://example.com/page/",
          content: "other",
          score: 0.1,
        },
        { title: "No url", content: "skip" },
      ],
    });
    expect(rows).toEqual([
      {
        title: "Page",
        url: "https://example.com/page?utm_source=newsletter",
        snippet: "snippet",
        score: 0.9,
      },
    ]);
  });

  it("returns an empty array when Tavily has no results", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key-value";
    global.fetch = jest.fn(async () => jsonResponse(200, { results: [] }));
    await expect(searchWeb("nothing")).resolves.toEqual([]);
  });

  it("treats trailing slashes as the same URL and strips utm params", () => {
    expect(normalizeSourceUrl("https://example.com/page")).toBe(
      normalizeSourceUrl("https://example.com/page/")
    );
    expect(normalizeSourceUrl("https://Example.com/page/?utm_campaign=spring&b=2&a=1")).toBe(
      "https://example.com/page?a=1&b=2"
    );
  });

  it("normalizes a Firecrawl payload without inventing metadata", () => {
    expect(
      normalizeFirecrawlPayload(
        {
          success: true,
          data: {
            markdown: "# Hello",
            metadata: { title: "Hello", sourceURL: "https://example.com/page" },
          },
        },
        "https://example.com/page"
      )
    ).toEqual({
      url: "https://example.com/page",
      title: "Hello",
      markdown: "# Hello",
      metadata: { title: "Hello", sourceURL: "https://example.com/page" },
      markdownCharCount: 7,
    });
  });

  it("returns empty markdown when Firecrawl succeeds with no content", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test-key-value";
    global.fetch = jest.fn(async () =>
      jsonResponse(200, { success: true, data: { markdown: "   ", metadata: {} } })
    );
    const result = await extractWebPage("https://example.com/empty");
    expect(result.markdown).toBe("");
    expect(result.markdownCharCount).toBe(0);
    expect(result.title).toBeNull();
  });

  it("rejects an unusable Firecrawl URL before calling the API", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test-key-value";
    global.fetch = jest.fn();
    await expect(extractWebPage("javascript:alert(1)")).rejects.toMatchObject({
      code: "invalid_url",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not leak the Tavily key in API errors", async () => {
    const secret = "tvly-secret-value-should-not-leak";
    process.env.TAVILY_API_KEY = secret;
    global.fetch = jest.fn(async () => jsonResponse(401, { error: `unauthorized ${secret}` }));
    try {
      await searchWeb("acme");
      throw new Error("expected TavilySearchError");
    } catch (error) {
      expect(error).toBeInstanceOf(TavilySearchError);
      expect(error.message).not.toContain(secret);
      expect(error.message).toContain("Tavily search failed");
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("does not leak the Firecrawl key in API errors", async () => {
    const secret = "fc-secret-value-should-not-leak";
    process.env.FIRECRAWL_API_KEY = secret;
    global.fetch = jest.fn(async () => jsonResponse(500, { error: `boom ${secret}` }));
    try {
      await extractWebPage("https://example.com/fail");
      throw new Error("expected FirecrawlExtractError");
    } catch (error) {
      expect(error).toBeInstanceOf(FirecrawlExtractError);
      expect(error.code).toBe("api_failure");
      expect(error.url).toBe("https://example.com/fail");
      expect(error.message).not.toContain(secret);
      expect(error.message).toContain("Firecrawl extraction failed");
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});

describe("structureInterviewQuestions", () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  it("extracts an explicitly reported coding question", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Implement an LRU cache.",
            kind: "coding",
            evidence: "I was asked to implement an LRU cache.",
          },
        ],
      })
    );

    const result = await structureInterviewQuestions({
      url: "https://example.com/experience",
      title: "Acme onsite",
      markdown: "I was asked to implement an LRU cache.",
    });

    expect(result.items).toEqual([
      {
        question: "Implement an LRU cache.",
        kind: "coding",
        answer: "",
        intuition: "",
        evidence: "I was asked to implement an LRU cache.",
        sourceUrl: "https://example.com/experience",
        sourceTitle: "Acme onsite",
      },
    ]);
    expect(result.items[0].status).toBeUndefined();
  });

  it("extracts an explicitly reported conceptual question", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Explain normalization in databases.",
            kind: "non_coding",
            evidence: "The interviewer asked me to explain normalization in databases.",
          },
        ],
      })
    );

    const result = await structureInterviewQuestions({
      url: "https://example.com/db",
      title: "Database round",
      markdown: "The interviewer asked me to explain normalization in databases.",
    });

    expect(result.items[0]).toMatchObject({
      question: "Explain normalization in databases.",
      kind: "non_coding",
      answer: "",
      intuition: "",
    });
  });

  it("returns no items when the model finds only preparation topics", async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await structureInterviewQuestions({
      url: "https://example.com/prep",
      title: "Prep notes",
      markdown: "Prepare arrays, graphs and dynamic programming.",
    });

    expect(result).toMatchObject({ items: [] });
    const messages = mockCallLLM.mock.calls[0][0];
    expect(messages[0].content).toContain("Do not turn topics");
    expect(messages[1].content).toContain("Prepare arrays, graphs and dynamic programming.");
  });

  it("keeps the application source URL and title when the model invents them", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Implement an LRU cache.",
            kind: "coding",
            evidence: "I was asked to implement an LRU cache.",
            sourceUrl: "https://evil.example/fake",
            sourceTitle: "Fake title",
          },
        ],
      })
    );

    const result = await structureInterviewQuestions({
      url: "https://example.com/real",
      title: "Real title",
      markdown: "I was asked to implement an LRU cache.",
    });

    expect(result.items[0].sourceUrl).toBe("https://example.com/real");
    expect(result.items[0].sourceTitle).toBe("Real title");
  });

  it("fails clearly when the model returns malformed JSON", async () => {
    mockCallLLM.mockResolvedValue("this is not json");

    await expect(
      structureInterviewQuestions({
        url: "https://example.com/bad",
        title: "Bad",
        markdown: "I was asked to reverse a linked list.",
      })
    ).rejects.toMatchObject({
      name: "StructureInterviewQuestionsError",
      code: "malformed_json",
    });
  });

  it("keeps grounded questions when another item on the same page is invalid", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Not grounded.",
            kind: "topic",
            evidence: "I was asked to implement an LRU cache.",
          },
          {
            question: "Implement an LRU cache.",
            kind: "coding",
            evidence: "I was asked to implement an LRU cache.",
          },
        ],
      })
    );

    const result = await structureInterviewQuestions({
      url: "https://example.com/experience",
      title: "Acme onsite",
      markdown: "**I was asked to implement an LRU cache.** [writeup](https://example.com/post)",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      question: "Implement an LRU cache.",
      kind: "coding",
      evidence: "I was asked to implement an LRU cache.",
    });
  });

  it("rejects an item with an invalid shape", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Implement an LRU cache.",
            kind: "topic",
            evidence: "I was asked to implement an LRU cache.",
          },
        ],
      })
    );

    await expect(
      structureInterviewQuestions({
        url: "https://example.com/experience",
        title: "Acme onsite",
        markdown: "I was asked to implement an LRU cache.",
      })
    ).rejects.toBeInstanceOf(StructureInterviewQuestionsError);
  });

  it("calls Groq with the web_search key slot", async () => {
    mockCallLLM.mockResolvedValue(JSON.stringify({ items: [] }));

    await structureInterviewQuestions({
      url: "https://example.com/prep",
      title: "Prep notes",
      markdown: "No questions here.",
    });

    expect(mockCallLLM).toHaveBeenCalledWith(expect.any(Array), {
      apiKeySlot: "web_search",
      temperature: 0.1,
    });
    const options = mockCallLLM.mock.calls[0][1];
    expect(options).not.toHaveProperty("apiKey");
  });
});

const mockSearchWeb = jest.fn();
const mockExtractWebPage = jest.fn();
const mockStructureInterviewQuestions = jest.fn();

jest.unstable_mockModule("../../services/companyResearch/tavilySearch.js", () => ({
  searchWeb: (...args) => mockSearchWeb(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/firecrawlExtract.js", () => ({
  extractWebPage: (...args) => mockExtractWebPage(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/structureWithGroq.js", () => ({
  structureInterviewQuestions: (...args) => mockStructureInterviewQuestions(...args),
}));

jest.resetModules();

const { researchInterviewQuestions, ResearchInterviewQuestionsError, normalizeQuestionKey } =
  await import("../../services/companyResearch/researchInterviewQuestions.js");

describe("researchInterviewQuestions", () => {
  beforeEach(() => {
    mockSearchWeb.mockReset();
    mockExtractWebPage.mockReset();
    mockStructureInterviewQuestions.mockReset();
  });

  it("runs a deterministic query per template, including role and country", async () => {
    mockSearchWeb.mockResolvedValue([]);

    const result = await researchInterviewQuestions({
      companyName: "Acme",
      role: "SDE",
      country: "India",
    });

    expect(mockSearchWeb.mock.calls.map((call) => call[0])).toEqual([
      '"Acme" "SDE" interview experience questions',
      '"Acme" "SDE" interview questions',
      '"Acme" "SDE" technical interview experience',
      '"Acme" "SDE" interview experience India',
    ]);
    expect(mockSearchWeb.mock.calls[0][1]).toEqual({ maxResults: 5, searchDepth: "basic" });
    expect(result.outcome).toBe("no_sources");
    expect(result.stats.searchQueries).toBe(4);
    expect(mockExtractWebPage).not.toHaveBeenCalled();
  });

  it("dedupes URLs and stops at maxSources", async () => {
    mockSearchWeb.mockImplementation(async (query) => {
      if (String(query).includes("experience questions")) {
        return [
          {
            title: "First",
            url: "https://example.com/page?utm_source=newsletter",
            snippet: "one",
            score: 0.4,
          },
          { title: "Second", url: "https://example.com/other", snippet: "two", score: null },
        ];
      }
      return [
        { title: "Dup", url: "https://example.com/page/", snippet: "dup", score: 0.9 },
        { title: "Third", url: "https://example.com/third", snippet: "three", score: 0.2 },
      ];
    });
    mockExtractWebPage.mockImplementation(async (url) => ({
      url,
      title: "Page",
      markdown: "I was asked to reverse a linked list.",
      markdownCharCount: 40,
    }));
    mockStructureInterviewQuestions.mockResolvedValue({ items: [], sourceTruncated: false });

    const result = await researchInterviewQuestions({
      companyName: "Acme",
      maxSources: 2,
    });

    expect(result.stats.searchedResults).toBeGreaterThan(2);
    expect(result.stats.uniqueSources).toBe(3);
    expect(result.stats.selectedSources).toBe(2);
    expect(result.sources).toHaveLength(3);
    expect(result.sources[2].extractionStatus).toBe("skipped");
    expect(result.sources[0].url).toBe("https://example.com/page?utm_source=newsletter");
    expect(result.sources[0].tavilyScore).toBe(0.4);
    expect(result.sources[1].tavilyScore).toBeNull();
    expect(result.sources[0].markdown).toBeUndefined();
    expect(mockExtractWebPage).toHaveBeenCalledTimes(2);
  });

  it("continues when one page fails extraction and one fails structuring", async () => {
    mockSearchWeb.mockResolvedValue([
      { title: "A", url: "https://example.com/a", snippet: "a", score: 0.5 },
      { title: "B", url: "https://example.com/b", snippet: "b", score: 0.4 },
      { title: "C", url: "https://example.com/c", snippet: "c", score: 0.3 },
    ]);
    mockExtractWebPage.mockImplementation(async (url) => {
      if (url.endsWith("/a")) {
        const error = new Error("Firecrawl extraction failed");
        error.code = "api_failure";
        throw error;
      }
      return {
        url,
        title: "Extracted",
        markdown: "The interviewer asked me to explain normalization.",
        markdownCharCount: 52,
      };
    });
    mockStructureInterviewQuestions.mockImplementation(async (source) => {
      if (source.url.endsWith("/b")) {
        const error = new Error("malformed");
        error.code = "malformed_json";
        throw error;
      }
      return {
        items: [
          {
            question: "Explain normalization in databases.",
            kind: "non_coding",
            answer: "",
            intuition: "",
            evidence: "The interviewer asked me to explain normalization.",
            sourceUrl: source.url,
            sourceTitle: source.title,
          },
        ],
        sourceTruncated: false,
      };
    });

    const result = await researchInterviewQuestions({ companyName: "Acme", maxSources: 3 });

    expect(result.outcome).toBe("ok");
    expect(result.sources.map((source) => source.extractionStatus)).toEqual([
      "failed",
      "extracted",
      "extracted",
    ]);
    expect(result.sources[0].errorCode).toBe("api_failure");
    expect(result.sources[1].structureStatus).toBe("failed");
    expect(result.sources[1].errorCode).toBe("malformed_json");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBeUndefined();
    expect(result.stats.extractedSources).toBe(2);
    expect(result.stats.failedSources).toBe(2);
    expect(result.stats.finalCandidates).toBe(1);
  });

  it("collapses obvious duplicate questions and keeps the other source", async () => {
    mockSearchWeb.mockResolvedValue([
      { title: "A", url: "https://example.com/a", snippet: "a", score: 1 },
      { title: "B", url: "https://example.com/b", snippet: "b", score: 1 },
    ]);
    mockExtractWebPage.mockImplementation(async (url) => ({
      url,
      markdown: "I was asked to implement an LRU cache.",
      markdownCharCount: 38,
    }));
    mockStructureInterviewQuestions.mockImplementation(async (source) => ({
      items: [
        {
          question: source.url.endsWith("/b") ? "implement an LRU cache!" : "Implement an LRU cache.",
          kind: "coding",
          answer: "",
          intuition: "",
          evidence: "I was asked to implement an LRU cache.",
          sourceUrl: source.url,
          sourceTitle: source.title,
        },
      ],
    }));

    expect(normalizeQuestionKey("Implement an LRU cache.")).toBe(
      normalizeQuestionKey("implement an LRU cache!")
    );

    const result = await researchInterviewQuestions({ companyName: "Acme", maxSources: 2 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].question).toBe("Implement an LRU cache.");
    expect(result.items[0].supportingSources).toEqual([
      {
        sourceUrl: "https://example.com/b",
        sourceTitle: "B",
        evidence: "I was asked to implement an LRU cache.",
      },
    ]);
    expect(result.stats.extractedCandidates).toBe(2);
    expect(result.stats.duplicateCandidates).toBe(1);
    expect(result.stats.finalCandidates).toBe(1);
  });

  it("fails the research when Tavily search fails", async () => {
    const error = new Error("Tavily search failed: HTTP 401");
    error.code = "api_failure";
    mockSearchWeb.mockRejectedValue(error);

    await expect(researchInterviewQuestions({ companyName: "Acme" })).rejects.toEqual(
      expect.any(ResearchInterviewQuestionsError)
    );
    await expect(researchInterviewQuestions({ companyName: "Acme" })).rejects.toMatchObject({
      code: "search_failed",
    });
    expect(mockExtractWebPage).not.toHaveBeenCalled();
  });

  it("returns a failed outcome when every selected source fails", async () => {
    mockSearchWeb.mockResolvedValue([
      { title: "A", url: "https://example.com/a", snippet: "a", score: null },
    ]);
    const error = new Error("nope");
    error.code = "api_failure";
    mockExtractWebPage.mockRejectedValue(error);

    const result = await researchInterviewQuestions({ companyName: "Acme" });

    expect(result.outcome).toBe("failed");
    expect(result.items).toEqual([]);
    expect(result.stats.finalCandidates).toBe(0);
    expect(result.stats.extractedSources).toBe(0);
    expect(result.sources[0].extractionStatus).toBe("failed");
    expect(mockStructureInterviewQuestions).not.toHaveBeenCalled();
  });
});
