import {
  normalizeFinalizeItems,
  parsePlatformPrepCsvRow,
} from "../../services/platformPrepCsvImportService.js";

describe("parsePlatformPrepCsvRow", () => {
  it("allows coding rows without intuition or language solutions", () => {
    const item = parsePlatformPrepCsvRow(
      {
        role: "SDE",
        kind: "coding",
        question: "LRU Cache",
        answer: "Use hashmap + list",
        intuition: "",
        solutions_cpp: "",
        solutions_java: "",
        solutions_python: "",
      },
      2
    );
    expect(item.kind).toBe("coding");
    expect(item.intuition).toBe("");
    expect(item.solutions).toEqual({ cpp: "", java: "", python: "" });
  });

  it("accepts a complete coding row", () => {
    const item = parsePlatformPrepCsvRow(
      {
        role: "Software Engineer",
        kind: "coding",
        question: "Implement LRU Cache",
        answer: "Hashmap + doubly linked list",
        intuition: "Move accessed nodes to front",
        solutions_cpp: "cpp code",
        solutions_java: "java code",
        solutions_python: "python code",
      },
      2
    );
    expect(item.kind).toBe("coding");
    expect(item.prepRoleKey).toBe("software-engineer");
    expect(item.solutions).toEqual({
      cpp: "cpp code",
      java: "java code",
      python: "python code",
    });
  });

  it("does not require coding solutions for non_coding rows", () => {
    const item = parsePlatformPrepCsvRow(
      {
        role: "SDE",
        kind: "non_coding",
        question: "Explain CAP theorem",
        answer: "Consistency, Availability, Partition tolerance",
      },
      3
    );
    expect(item.kind).toBe("non_coding");
    expect(item.solutions).toBeUndefined();
  });
});

describe("normalizeFinalizeItems", () => {
  it("accepts coding items with empty language solutions", () => {
    const items = normalizeFinalizeItems([
      {
        prepRoleKey: "sde",
        prepRoleLabel: "SDE",
        kind: "coding",
        question: "Two Sum",
        answer: "Hash map",
        intuition: "",
        solutions: { cpp: "", java: "", python: "" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].solutions).toEqual({ cpp: "", java: "", python: "" });
  });
});
