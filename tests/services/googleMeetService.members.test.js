import { describe, expect, it } from "@jest/globals";
import { addMeetSpaceMember } from "../../services/googleMeetService.js";

describe("addMeetSpaceMember", () => {
  it("skips when space name is missing", async () => {
    await expect(addMeetSpaceMember({ spaceName: "", email: "a@b.com" })).resolves.toEqual({
      ok: false,
      skipped: true,
      error: "missing_space",
    });
  });

  it("skips when email is missing", async () => {
    await expect(
      addMeetSpaceMember({ spaceName: "spaces/abc", email: "" })
    ).resolves.toEqual({
      ok: false,
      skipped: true,
      error: "missing_email",
    });
  });
});
