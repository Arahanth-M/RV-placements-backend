import {
  CPP_GRADER_MAIN_CONFLICT_ERROR,
  hasTopLevelMainFunction,
  isCppMainRedefinitionCompileError,
} from "../../services/codeExecution/cppHarnessGenerator.js";

describe("C++ grader main() contract", () => {
  it("detects a top-level int main()", () => {
    const code = `
#include <bits/stdc++.h>
using namespace std;
int twoSum(vector<int>& nums, int target) { return 0; }
int main() {
  return 0;
}
`;
    expect(hasTopLevelMainFunction(code)).toBe(true);
  });

  it("detects signed main() used in contest-style code", () => {
    expect(hasTopLevelMainFunction("signed main() { return 0; }")).toBe(true);
  });

  it("does not treat class Solution methods as main()", () => {
    const code = `
class Solution {
public:
  int twoSum(vector<int>& nums, int target) { return 0; }
};
`;
    expect(hasTopLevelMainFunction(code)).toBe(false);
  });

  it("recognizes g++ redefinition of int main()", () => {
    const stderr = `/workspace/main.cpp:49:5: error: redefinition of 'int main()'
   49 | int main() {
      |     ^~~~
In file included from /workspace/main.cpp:42:
/workspace/solution.cpp:23:5: note: 'int main()' previously defined here`;
    expect(isCppMainRedefinitionCompileError(stderr)).toBe(true);
    expect(CPP_GRADER_MAIN_CONFLICT_ERROR).toMatch(/int main\(\)/);
  });
});
