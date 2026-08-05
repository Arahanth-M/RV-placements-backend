import { jest } from "@jest/globals";

describe("groqApiKey", () => {
  const originalEnv = process.env;
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
  });

  afterAll(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  it("resolveGroqApiKey uses GROQ_KEY_ADMIN when slot is admin", async () => {
    process.env.GROQ_KEY_SLOT = "admin";
    process.env.GROQ_KEY_ADMIN = "gsk_admin_test";
    delete process.env.GROQ_API_KEY;

    const { resolveGroqApiKey } = await import("../../config/groqApiKey.js");
    expect(resolveGroqApiKey()).toBe("gsk_admin_test");
  });

  it("detectGroqKeySlot infers interview_worker from argv", async () => {
    delete process.env.GROQ_KEY_SLOT;
    process.argv = ["node", "/app/workers/interviewWorker.js"];
    process.env.GROQ_KEY_INTERVIEW_WORKER = "gsk_worker_test";

    const { detectGroqKeySlot, resolveGroqApiKey } = await import("../../config/groqApiKey.js");
    expect(detectGroqKeySlot()).toBe("interview_worker");
    expect(resolveGroqApiKey()).toBe("gsk_worker_test");
  });

  it("falls back to GROQ_API_KEY when slot is unknown", async () => {
    delete process.env.GROQ_KEY_SLOT;
    process.argv = ["node", "scripts/foo.js"];
    process.env.GROQ_API_KEY = "gsk_legacy";

    const { resolveGroqApiKey } = await import("../../config/groqApiKey.js");
    expect(resolveGroqApiKey()).toBe("gsk_legacy");
  });

  it("resolveGroqApiKey uses GROQ_KEY_PREP_PATH when slot is prep_path", async () => {
    process.env.GROQ_KEY_PREP_PATH = "gsk_prep_path_test";
    process.env.GROQ_KEY_ADMIN = "gsk_admin_test";
    delete process.env.GROQ_API_KEY;

    const { resolveGroqApiKey, GROQ_KEY_SLOTS } = await import(
      "../../config/groqApiKey.js"
    );
    expect(resolveGroqApiKey(GROQ_KEY_SLOTS.PREP_PATH)).toBe("gsk_prep_path_test");
    expect(resolveGroqApiKey("prep-path")).toBe("gsk_prep_path_test");
  });
});
