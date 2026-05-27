import request from "supertest";
import app from "../../server.js";

describe("Resume routes auth", () => {
  it("rejects unauthenticated get draft", async () => {
    const response = await request(app).get("/api/resume/draft").expect(401);
    expect(response.body).toHaveProperty("error");
  });

  it("rejects unauthenticated save draft", async () => {
    const response = await request(app)
      .put("/api/resume/draft")
      .send({
        version: 0,
        payload: {
          templateId: "standard_ats",
          personal: {},
          education: [],
          skills: [],
          projects: [],
          experience: [],
          certifications: [],
          achievements: [],
        },
      })
      .expect(401);
    expect(response.body).toHaveProperty("error");
  });

  it("rejects unauthenticated analyze resume", async () => {
    const response = await request(app)
      .post("/api/resume/analyze")
      .send({
        payload: {
          templateId: "standard_ats",
          personal: {},
          education: [],
          skills: [],
          projects: [],
          experience: [],
          certifications: [],
          achievements: [],
        },
      })
      .expect(401);
    expect(response.body).toHaveProperty("error");
  });
});
