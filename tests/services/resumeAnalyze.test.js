import { analyzeResume } from "../../services/resume/analyze/index.js";
import { SCORER_VERSION } from "../../services/resume/analyze/constants.js";
import {
  analyzeBullet,
  isProfessionalEmail,
} from "../../services/resume/analyze/scoringUtils.js";

const samplePayload = {
  templateId: "standard_ats",
  personal: {
    fullName: "Test User",
    email: "test@example.com",
    phone: "+91-9999999999",
    location: "Bengaluru",
    linkedin: "https://linkedin.com/in/test-user",
    github: "https://github.com/test-user",
    summary:
      "Computer science student with internship experience building APIs and dashboards in Python and React.",
  },
  education: [
    {
      institution: "RV College Of Engineering",
      degree: "B.E.",
      field: "Computer Science",
      startDate: "2022",
      endDate: "2026",
      score: "GPA: 9.5",
      location: "Bengaluru",
    },
  ],
  skills: ["Python", "React", "Node.js", "MongoDB", "Docker"],
  projects: [
    {
      name: "Asset Tracker",
      techStack: "Python, Firebase",
      link: "https://github.com/test-user/asset-tracker",
      startDate: "Jan 2025",
      endDate: "Mar 2025",
      bullets: [{ text: "Built a real-time tracking dashboard used by 200+ users." }],
    },
  ],
  experience: [
    {
      company: "Example Corp",
      role: "Software Intern",
      techStack: "Python, React",
      location: "Remote",
      startDate: "May 2025",
      endDate: "Jul 2025",
      bullets: [{ text: "Shipped API improvements that reduced latency by 30%." }],
    },
  ],
  certifications: [{ title: "AWS Cloud Practitioner", link: "" }],
  achievements: [{ title: "Hackathon Winner", detail: "2024" }],
};

describe("resume analyze service", () => {
  it("returns stable output shape", () => {
    const result = analyzeResume(samplePayload);

    expect(result.scorerVersion).toBe(SCORER_VERSION);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.breakdown).toMatchObject({
      completeness: expect.any(Number),
      structure: expect.any(Number),
      bulletQuality: expect.any(Number),
      skills: expect.any(Number),
      professionalism: expect.any(Number),
    });
    expect(typeof result.interviewReady).toBe("boolean");
    expect(Array.isArray(result.driveChecklist)).toBe(true);
    expect(Array.isArray(result.tips)).toBe(true);
    if (result.tips.length > 0) {
      expect(result.tips[0]).toMatchObject({
        id: expect.any(String),
        category: expect.any(String),
        severity: expect.any(String),
        title: expect.any(String),
        message: expect.any(String),
      });
    }
    expect(result.matchedKeywords).toBeUndefined();
    expect(result.missingKeywords).toBeUndefined();
  });

  it("is deterministic for the same input", () => {
    const first = analyzeResume(samplePayload);
    const second = analyzeResume(samplePayload);
    expect(second).toEqual(first);
  });

  it("does not mutate the input payload", () => {
    const payload = JSON.parse(JSON.stringify(samplePayload));
    const before = JSON.stringify(payload);
    analyzeResume(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("penalizes sparse resumes", () => {
    const sparse = {
      templateId: "standard_ats",
      personal: { fullName: "A", email: "a@b.com" },
      education: [],
      skills: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
    };
    const strong = analyzeResume(samplePayload);
    const weak = analyzeResume(sparse);

    expect(weak.overallScore).toBeLessThan(strong.overallScore);
    expect(weak.tips.length).toBeGreaterThan(0);
    expect(weak.interviewReady).toBe(false);
    expect(weak.driveChecklist.length).toBeGreaterThan(0);
  });

  it("does not emit praise tips when bullet quality is only moderate", () => {
    const moderateBullets = {
      ...samplePayload,
      projects: [
        {
          name: "Todo App",
          techStack: "React",
          link: "https://github.com/test-user/todo",
          startDate: "2024",
          endDate: "2024",
          bullets: [{ text: "Worked on frontend features for the application." }],
        },
      ],
      experience: [],
    };
    const result = analyzeResume(moderateBullets);
    const praiseTips = result.tips.filter((t) => t.kind === "praise");
    expect(praiseTips).toHaveLength(0);
    if (result.breakdown.bulletQuality < 85) {
      expect(result.tips.some((t) => t.id === "bullets-strong")).toBe(false);
    }
  });
});

describe("scoringUtils", () => {
  it("accepts official or name-based emails and rejects fancy handles", () => {
    expect(isProfessionalEmail("rahul.sharma@gmail.com")).toBe(true);
    expect(isProfessionalEmail("rahul.sharma@rvce.edu.in")).toBe(true);
    expect(isProfessionalEmail("coolgamer99@gmail.com")).toBe(false);
    expect(isProfessionalEmail("12345abc@gmail.com")).toBe(false);
    expect(isProfessionalEmail("user@mailinator.com")).toBe(false);
  });

  it("detects strong vs weak bullets", () => {
    const strong = analyzeBullet("Developed a React dashboard that increased engagement by 25%.");
    const weak = analyzeBullet("Helped with team tasks.");
    const passive = analyzeBullet("The API was developed by the team.");

    expect(strong.hasActionVerb).toBe(true);
    expect(strong.hasMetric).toBe(true);
    expect(strong.isWeak).toBe(false);
    expect(weak.isWeak).toBe(true);
    expect(weak.hasWeakVerb).toBe(true);
    expect(passive.hasPassivePhrase).toBe(true);
  });
});
