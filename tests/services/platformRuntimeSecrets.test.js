import { jest } from "@jest/globals";

const store = new Map();

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: async (key) => store.get(key) ?? null,
  setJSON: async (key, value) => {
    store.set(key, value);
    return true;
  },
}));

const { listRuntimeSecrets, setRuntimeSecret, clearRuntimeSecret } = await import(
  "../../services/platformRuntimeSecrets.js"
);

const FULL_KEY = "gsk_admin_secret_value_ABCD";

describe("platform runtime secrets", () => {
  const previous = process.env.GROQ_KEY_ADMIN;

  beforeEach(() => {
    store.clear();
    process.env.GROQ_KEY_ADMIN = "gsk_env_default_WXYZ";
  });

  afterAll(() => {
    if (previous == null) delete process.env.GROQ_KEY_ADMIN;
    else process.env.GROQ_KEY_ADMIN = previous;
  });

  it("lists a masked hint and never returns the full key", async () => {
    const keys = await listRuntimeSecrets();
    const admin = keys.find((row) => row.id === "groq-admin");
    expect(admin.hint).toBe("••••WXYZ");
    expect(admin.source).toBe("env");
    expect(JSON.stringify(keys)).not.toContain("gsk_env_default_WXYZ");
  });

  it("replaces the live key and can restore the server default", async () => {
    const updated = await setRuntimeSecret("groq-admin", FULL_KEY);
    expect(updated.source).toBe("override");
    expect(updated.hint).toBe("••••ABCD");
    expect(JSON.stringify(updated)).not.toContain(FULL_KEY);
    expect(process.env.GROQ_KEY_ADMIN).toBe(FULL_KEY);

    const restored = await clearRuntimeSecret("groq-admin");
    expect(restored.source).toBe("env");
    expect(restored.hint).toBe("••••WXYZ");
    expect(process.env.GROQ_KEY_ADMIN).toBe("gsk_env_default_WXYZ");
  });

  it("rejects a masked paste and an unknown key", async () => {
    await expect(setRuntimeSecret("groq-admin", "••••ABCD")).rejects.toMatchObject({ status: 400 });
    await expect(setRuntimeSecret("groq-other", FULL_KEY)).rejects.toMatchObject({ status: 400 });
  });
});
