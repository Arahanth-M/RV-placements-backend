import request from "supertest";
import app from "../../server.js";

describe("Placement routes", () => {
  describe("GET /api/placement/form", () => {
    it("redirects to the configured Google Form", async () => {
      const response = await request(app)
        .get("/api/placement/form")
        .expect(302);

      expect(response.headers.location).toMatch(
        /^https:\/\/docs\.google\.com\/forms\/d\/e\//
      );
    });
  });
});
