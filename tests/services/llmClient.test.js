import { jest } from "@jest/globals";

const mockCreate = jest.fn();

jest.unstable_mockModule("groq-sdk", () => ({
  default: class Groq {
    constructor() {
      this.chat = {
        completions: {
          create: (...args) => mockCreate(...args),
        },
      };
    }
  },
}));

const originalEnv = process.env;
process.env = {
  ...originalEnv,
  GROQ_API_KEY: "gsk_test_llm_client",
};
delete process.env.GROQ_KEY_SLOT;

const { callLLM } = await import("../../services/llmClient.js");

function jsonValidateError() {
  const body = {
    error: {
      message:
        "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: '{"answer":"1. Leaders',
    },
  };
  const error = new Error(`400 ${JSON.stringify(body)}`);
  error.status = 400;
  error.error = body;
  return error;
}

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  mockCreate.mockReset();
});

describe("callLLM json validation retry", () => {
  it("retries a json_validate_failed response once with a larger completion budget", async () => {
    mockCreate
      .mockRejectedValueOnce(jsonValidateError())
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"answer":"Leaders are scanned from the right."}' } }],
      });

    const text = await callLLM(
      [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Question: Leaders in an array" },
      ],
      {
        max_completion_tokens: 3072,
        response_format: { type: "json_object" },
        reasoning_effort: "low",
      }
    );

    expect(text).toBe('{"answer":"Leaders are scanned from the right."}');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(3072);
    expect(mockCreate.mock.calls[1][0].max_completion_tokens).toBe(8192);
    expect(mockCreate.mock.calls[1][0].messages).toHaveLength(3);
    expect(mockCreate.mock.calls[1][0].messages[2].content).toContain("Escape newlines");
  });

  it("does not retry json_validate_failed a second time", async () => {
    mockCreate.mockRejectedValue(jsonValidateError());

    await expect(
      callLLM([{ role: "user", content: "Question: Pairs with sum divisible by K" }], {
        max_completion_tokens: 3072,
        response_format: { type: "json_object" },
      })
    ).rejects.toThrow(/json_validate_failed/);

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
