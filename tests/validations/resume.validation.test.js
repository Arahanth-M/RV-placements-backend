import { resumeDraftSaveSchema, resumeExportSchema } from "../../validations/resume.validation.js";

const emptyPayload = {
  templateId: "standard_ats",
  personal: {
    fullName: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
    github: "",
    summary: "",
  },
  education: [],
  skills: [],
  projects: [],
  experience: [],
  certifications: [],
  achievements: [],
};

describe("resume.validation", () => {
  it("allows saving a draft with no skills yet", () => {
    const { error } = resumeDraftSaveSchema.validate({ version: 0, payload: emptyPayload });
    expect(error).toBeUndefined();
  });

  it("requires at least one skill for export", () => {
    const { error } = resumeExportSchema.validate({ payload: emptyPayload });
    expect(error).toBeDefined();
  });
});
