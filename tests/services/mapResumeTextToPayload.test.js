import { describe, it, expect } from "@jest/globals";
import { mapResumeTextToPayload } from "../../services/resume/analyze/mapResumeTextToPayload.js";
import { analyzeResume } from "../../services/resume/analyze/index.js";

const SAMPLE = `
Rahul Sharma
rahul.sharma@rvce.edu.in
+91 9876543210
https://linkedin.com/in/rahul-sharma
https://github.com/rahulsharma
Bengaluru, India

Summary
Computer science student who built APIs and dashboards in Python and React for campus projects.

Education
RV College of Engineering
B.E. Computer Science
CGPA 9.1
2022-2026

Skills
Python, React, Node.js, MongoDB, Docker, SQL

Experience
Example Corp | Software Intern
May 2025 - Jul 2025
- Built REST APIs that reduced dashboard latency by 30%
- Developed React views used by 200+ students

Projects
Asset Tracker
Python, Firebase
https://github.com/rahulsharma/asset-tracker
- Implemented real-time location updates for 50 campus assets

Certifications
AWS Cloud Practitioner

Achievements
Hackathon Winner 2024
`;

describe("mapResumeTextToPayload", () => {
  it("extracts contact, skills, and bullets from plain resume text", () => {
    const payload = mapResumeTextToPayload(SAMPLE);
    expect(payload.personal.email).toBe("rahul.sharma@rvce.edu.in");
    expect(payload.personal.linkedin).toMatch(/linkedin\.com\/in\/rahul-sharma/i);
    expect(payload.personal.github).toMatch(/github\.com\/rahulsharma/i);
    expect(payload.skills).toEqual(
      expect.arrayContaining(["Python", "React", "Node.js", "MongoDB"])
    );
    expect(payload.education).toHaveLength(1);
    expect(payload.education[0]?.institution).toMatch(/RV College/i);
    expect(payload.experience.length).toBeGreaterThan(0);
    expect(payload.experience[0].bullets[0]?.text).toMatch(/latency/i);
    expect(payload.projects.length).toBeGreaterThan(0);
  });

  it("produces a payload the ATS scorer can score", () => {
    const payload = mapResumeTextToPayload(SAMPLE);
    const result = analyzeResume(payload);
    expect(result.overallScore).toBeGreaterThan(40);
    expect(result.breakdown.completeness).toBeGreaterThan(0);
    expect(Array.isArray(result.tips)).toBe(true);
  });
});
