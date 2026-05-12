/**
 * Bulk upsert DSA interview questions
 *
 * Usage:
 * cd RV-placements-backend &&
 * node scripts/insertBulkQuestionsV1.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import InterviewQuestion from "../models/InterviewQuestion.js";

dotenv.config();

const QUESTIONS = [

/* =========================================================
   1. PROCESS STAGES
========================================================= */

{
  questionId: "dsa_my_problem_v5",

  title: "Process Stage Tracking",

  companyTags: ["Flipkart"],

  roundType: "DSA",

  difficulty: "easy",

  evaluationStrategy: "code_execution",

  topics: [
    "Simulation",
    "Hashing",
    "State Tracking",
  ],

  subtopics: [
    "Process transitions",
    "Feasibility checking",
  ],

  question: `In an operating system, there are P processes numbered from 1 to P.

Each process can move between stages:
A → B → C → E
          ↓
          D
          ↑
          B

Allowed transitions:
- AB
- BC
- CB
- CD
- DB
- CE

Initially all processes are in stage A.

Each execution step is given as:
SD X

where:
- SD = transition
- X = process number

A transition is executed only if it is valid and the process is currently at the required source stage.

Invalid transitions are ignored.

Return the final list of processes present in stages A, B, C, D and E.

Processes in every stage must be printed in sorted order.`,

  dsaMetadata: {
    supportedLanguages: ["python", "java", "cpp"],

    functionSignature:
      "def process_stage_tracking(p, operations):",

    starterCode: {
      python:
`def process_stage_tracking(p, operations):
    pass
`,

      java:
`import java.util.*;

class Solution {
    public List<List<Integer>> processStageTracking(
        int p,
        List<String[]> operations
    ) {
        return new ArrayList<>();
    }
}
`,

      cpp:
`#include <vector>
#include <string>
using namespace std;

vector<vector<int>> process_stage_tracking(
    int p,
    vector<pair<string,int>>& operations
) {
    return {};
}
`,
    },
  },

  testCases: [

    {
      input: {
        p: 10,
        operations: [
          ["AB",2],
          ["AB",5],
          ["AB",8],
          ["AB",4],
          ["AB",9],
          ["BC",5],
          ["BC",8],
          ["BC",9],
          ["CB",5],
          ["CD",8],
          ["CE",9]
        ]
      },
      expectedOutput: [
        [1,3,6,7,10],
        [2,4,5],
        [],
        [8],
        [9]
      ],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        p: 3,
        operations: [
          ["BC",1],
          ["AB",1],
          ["BC",1]
        ]
      },
      expectedOutput: [
        [2,3],
        [],
        [1],
        [],
        []
      ],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        p: 2,
        operations: []
      },
      expectedOutput: [
        [1,2],
        [],
        [],
        [],
        []
      ],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        p: 1,
        operations: [
          ["AB",1],
          ["BC",1],
          ["CD",1]
        ]
      },
      expectedOutput: [
        [],
        [],
        [],
        [1],
        []
      ],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        p: 4,
        operations: [
          ["AB",1],
          ["BC",1],
          ["DB",1]
        ]
      },
      expectedOutput: [
        [2,3,4],
        [],
        [1],
        [],
        []
      ],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        p: 5,
        operations: [
          ["AB",1],
          ["BC",1],
          ["CB",1],
          ["BC",1],
          ["CE",1]
        ]
      },
      expectedOutput: [
        [2,3,4,5],
        [],
        [],
        [],
        [1]
      ],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        p: 3,
        operations: [
          ["AB",1],
          ["AB",2],
          ["BC",1],
          ["CD",1],
          ["DB",1]
        ]
      },
      expectedOutput: [
        [3],
        [1,2],
        [],
        [],
        []
      ],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        p: 2,
        operations: [
          ["AB",1],
          ["CE",1]
        ]
      },
      expectedOutput: [
        [2],
        [1],
        [],
        [],
        []
      ],
      isHidden: true,
      weight: 1,
    }
  ],

  complexity: {
    time: "O(P + Q)",
    space: "O(P)",
  },
},

/* =========================================================
   2. EXTRACT AND SORT NUMBERS
========================================================= */

{
  questionId: "dsa_my_problem_v6",

  title: "Extract and Sort Numbers",

  companyTags: ["Flipkart"],

  roundType: "DSA",

  difficulty: "easy",

  evaluationStrategy: "code_execution",

  topics: [
    "Strings",
    "Parsing",
    "Sorting",
  ],

  subtopics: [
    "Regex",
    "Leading zeros",
  ],

  question: `You are given N strings containing lowercase English letters and digits.

Extract all integer values present in the strings.

Rules:
- Remove leading zeros from extracted numbers.
- If the number itself is zero, keep it as 0.
- Duplicate numbers must also appear in output.
- Print all extracted numbers in non-decreasing order.`,

  dsaMetadata: {
    supportedLanguages: ["python", "java", "cpp"],

    functionSignature:
      "def extract_sort_numbers(arr):",

    starterCode: {
      python:
`def extract_sort_numbers(arr):
    pass
`,

      java:
`import java.util.*;

class Solution {
    public List<Integer> extractSortNumbers(
        List<String> arr
    ) {
        return new ArrayList<>();
    }
}
`,

      cpp:
`#include <vector>
#include <string>
using namespace std;

vector<int> extract_sort_numbers(
    vector<string>& arr
) {
    return {};
}
`,
    },
  },

  testCases: [

    {
      input: {
        arr: [
          "6rgg09n4l7",
          "b28xc7k9"
        ]
      },
      expectedOutput: [4,6,7,7,9,9,28],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        arr: ["abc"]
      },
      expectedOutput: [],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        arr: ["000"]
      },
      expectedOutput: [0],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        arr: ["a01b002c0003"]
      },
      expectedOutput: [1,2,3],
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        arr: ["1a2b3c"]
      },
      expectedOutput: [1,2,3],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        arr: ["0009", "09", "9"]
      },
      expectedOutput: [9,9,9],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        arr: ["12abc34", "056def078"]
      },
      expectedOutput: [12,34,56,78],
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        arr: ["999"]
      },
      expectedOutput: [999],
      isHidden: true,
      weight: 1,
    }
  ],

  complexity: {
    time: "O(total_characters + M log M)",
    space: "O(M)",
  },
},

/* =========================================================
   3. 2048 SCORE
========================================================= */

{
  questionId: "dsa_my_problem_v7",

  title: "2048 Final Score",

  companyTags: ["Flipkart"],

  roundType: "DSA",

  difficulty: "medium",

  evaluationStrategy: "code_execution",

  topics: [
    "Simulation",
    "Matrix",
    "Implementation",
  ],

  subtopics: [
    "Grid movement",
    "Merge simulation",
  ],

  question: `Given a 4x4 2048 game grid and a sequence of moves,
compute the final score.

Rules:
- Equal adjacent values merge.
- Every tile can merge at most once per move.
- Score increases by merged value.
- Valid moves:
  U, D, L, R.`,

  dsaMetadata: {
    supportedLanguages: ["python", "java", "cpp"],

    functionSignature:
      "def final_2048_score(grid, operations):",

    starterCode: {
      python:
`def final_2048_score(grid, operations):
    pass
`,

      java:
`import java.util.*;

class Solution {
    public int final2048Score(
        int[][] grid,
        List<Character> operations
    ) {
        return 0;
    }
}
`,

      cpp:
`#include <vector>
using namespace std;

int final_2048_score(
    vector<vector<int>>& grid,
    vector<char>& operations
) {
    return 0;
}
`,
    },
  },

  testCases: [

    {
      input: {
        grid: [
          [16,256,256,512],
          [4,0,0,32],
          [64,0,0,8],
          [2,2,1024,2]
        ],
        operations: ["R","D"]
      },
      expectedOutput: 516,
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        grid: [
          [2,2,0,0],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["L"]
      },
      expectedOutput: 4,
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        grid: [
          [2,2,2,2],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["L"]
      },
      expectedOutput: 8,
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        grid: [
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["R"]
      },
      expectedOutput: 0,
      isHidden: false,
      weight: 1,
    },

    {
      input: {
        grid: [
          [4,4,4,4],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["L"]
      },
      expectedOutput: 16,
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        grid: [
          [2,0,2,0],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["L"]
      },
      expectedOutput: 4,
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        grid: [
          [2,2,4,4],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["R"]
      },
      expectedOutput: 12,
      isHidden: true,
      weight: 1,
    },

    {
      input: {
        grid: [
          [8,8,8,0],
          [0,0,0,0],
          [0,0,0,0],
          [0,0,0,0]
        ],
        operations: ["L"]
      },
      expectedOutput: 16,
      isHidden: true,
      weight: 1,
    }
  ],

  complexity: {
    time: "O(N)",
    space: "O(1)",
  },
},

];