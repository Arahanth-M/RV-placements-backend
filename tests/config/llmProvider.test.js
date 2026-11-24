import { jest } from "@jest/globals";

describe("llmProvider", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  it("forces openrouter when LLM_PROVIDER=openrouter", async () => {
    process.env.LLM_PROVIDER = "openrouter";
    delete process.env.OPENROUTER_API_KEY;
    const { resolveLlmProvider } = await import("../../config/llmProvider.js");
    expect(resolveLlmProvider()).toBe("openrouter");
  });

  it("auto-selects openrouter when OPENROUTER_API_KEY is set", async () => {
    delete process.env.LLM_PROVIDER;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const { resolveLlmProvider } = await import("../../config/llmProvider.js");
    expect(resolveLlmProvider()).toBe("openrouter");
  });

  it("falls back to groq when no openrouter key and no explicit provider", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    const { resolveLlmProvider } = await import("../../config/llmProvider.js");
    expect(resolveLlmProvider()).toBe("groq");
  });

  it("resolveOpenRouterApiKey throws when missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { resolveOpenRouterApiKey } = await import("../../config/llmProvider.js");
    expect(() => resolveOpenRouterApiKey()).toThrow(/Missing OPENROUTER_API_KEY/);
  });
});
