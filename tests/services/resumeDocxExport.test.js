import { buildDocxBufferFromResume } from "../../services/resumeDocxExport.js";

const samplePayload = {
  templateId: "iiitv_latex_style",
  personal: {
    fullName: "Test User",
    email: "test@example.com",
    phone: "+91-9999999999",
    location: "Bengaluru",
    linkedin: "https://linkedin.com/in/test-user",
    github: "https://github.com/test-user",
    summary: "Engineer summary.",
  },
  education: [
    {
      institution: "RV College",
      degree: "B.E.",
      field: "CSE",
      startDate: "2022",
      endDate: "2026",
      score: "9.5",
      location: "Bengaluru",
    },
  ],
  skills: ["JavaScript", "React"],
  projects: [
    {
      name: "Dashboard",
      techStack: "React",
      link: "https://github.com/test-user/app",
      startDate: "2024",
      endDate: "2025",
      bullets: [{ text: "Built UI." }],
    },
  ],
  experience: [
    {
      company: "Acme",
      role: "Intern",
      techStack: "React, Node.js",
      location: "Bengaluru",
      startDate: "2025",
      endDate: "2025",
      bullets: [{ text: "Shipped features." }],
    },
  ],
  certifications: [{ title: "AWS Cloud Practitioner", link: "https://www.credly.com/badges/example" }],
  achievements: [{ title: "Hackathon", detail: "Winner" }],
};

describe("resumeDocxExport", () => {
  it("builds IIITV Word document", async () => {
    const buffer = await buildDocxBufferFromResume(samplePayload);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50); // PK zip header
    expect(buffer[1]).toBe(0x4b);
  });

  it("builds standard ATS Word document", async () => {
    const buffer = await buildDocxBufferFromResume({
      ...samplePayload,
      templateId: "standard_ats",
    });
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
