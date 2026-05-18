import { PDFDocument } from "pdf-lib";
import { buildPdfBufferFromResume } from "../../services/resumePdfExport.js";

const samplePayload = {
  templateId: "iiitv_latex_style",
  personal: {
    fullName: "Test User",
    email: "test@example.com",
    phone: "+91-9999999999",
    location: "Bengaluru",
    linkedin: "https://linkedin.com/in/test-user",
    github: "https://github.com/test-user",
    summary: "Computer science student with internship experience.",
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
  skills: ["Python", "C++", "React"],
  projects: [
    {
      name: "Asset Tracker",
      techStack: "Python, Firebase",
      link: "https://github.com/test-user/asset-tracker",
      startDate: "Jan 2025",
      endDate: "Mar 2025",
      bullets: [{ text: "Built real-time tracking dashboard." }],
    },
  ],
  experience: [
    {
      company: "Example Corp",
      role: "Intern",
      location: "Remote",
      startDate: "May 2025",
      endDate: "Jul 2025",
      bullets: [{ text: "Shipped API improvements." }],
    },
  ],
  certifications: [{ title: "AWS Cloud Practitioner", detail: "Amazon Web Services" }],
  achievements: [{ title: "Hackathon Winner", detail: "2024" }],
};

describe("resumePdfExport", () => {
  it("builds a compact IIITV PDF with summary and link annotations", async () => {
    const buffer = await buildPdfBufferFromResume(samplePayload);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.length).toBeLessThan(120_000);

    const doc = await PDFDocument.load(buffer);
    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size() ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("builds standard ATS PDF", async () => {
    const buffer = await buildPdfBufferFromResume({
      ...samplePayload,
      templateId: "standard_ats",
    });
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.length).toBeLessThan(120_000);
  });
});
