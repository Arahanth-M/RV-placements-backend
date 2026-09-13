import { normalizeSolutionText } from "../../utils/normalizeSolutionText.js";

describe("normalizeSolutionText", () => {
  it("unwraps a JSON array of escaped C++", () => {
    const stored = JSON.stringify(
      ["#include <bits/stdc++.h>\nusing namespace std;\nint main() { return 0; }"],
      null,
      2
    );
    const out = normalizeSolutionText(stored);
    expect(out.startsWith("#include")).toBe(true);
    expect(out).toContain("using namespace std;");
    expect(out.includes("\\n")).toBe(false);
  });
});
