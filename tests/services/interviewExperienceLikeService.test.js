import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import InterviewExperienceLike from "../../models/InterviewExperienceLike.js";
import { COMPANY_VISIT_YEAR } from "../../services/companyService.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import {
  attachInterviewExperienceLikes,
  contentExperienceKey,
  toggleInterviewExperienceLike,
} from "../../services/interviewExperienceLikeService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("interview experience likes", () => {
  it("toggles a like on a platform interview experience", async () => {
    const { staticRow } = await seedApprovedSplitCompany({ name: "Like Platform Co" });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      interviewExperiences: [{ status: "approved", content: "Round 1: OA with two questions." }],
    });

    const detail = await getCompanyPlatformDetailById(String(staticRow._id));
    const experienceKey = `p:${detail.interviewProcess[0].id}`;
    const liked = await toggleInterviewExperienceLike(
      String(staticRow._id),
      experienceKey,
      "Ada@College.edu"
    );
    expect(liked).toEqual({ experienceKey, likeCount: 1, likedByMe: true });

    const again = await toggleInterviewExperienceLike(
      String(staticRow._id),
      experienceKey,
      "ada@college.edu"
    );
    expect(again).toEqual({ experienceKey, likeCount: 0, likedByMe: false });
    expect(await InterviewExperienceLike.countDocuments()).toBe(0);
  });

  it("counts visit experiences by content and reports the viewer", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({ name: "Like Visit Co" });
    const content = "Round 1: Technical interview on graphs.";
    visit.interviewProcess = [content];
    await visit.save();

    const stored = await CompanyVisit.findById(visit._id).lean();
    expect(stored.interviewProcess).toEqual([content]);

    const experienceKey = contentExperienceKey(content);
    await toggleInterviewExperienceLike(String(staticRow._id), experienceKey, "one@college.edu");
    await toggleInterviewExperienceLike(String(staticRow._id), experienceKey, "two@college.edu");

    const payload = await attachInterviewExperienceLikes(
      { _id: staticRow._id, interviewProcess: [content] },
      "one@college.edu"
    );
    expect(payload.interviewProcess[0]).toMatchObject({
      content,
      experienceKey,
      likeCount: 2,
      likedByMe: true,
    });
  });

  it("rejects a like for an experience that is not on the company", async () => {
    const { staticRow } = await seedApprovedSplitCompany({ name: "Missing Experience Co" });
    await expect(
      toggleInterviewExperienceLike(String(staticRow._id), "c:doesnotexist000000000000", "a@b.edu")
    ).rejects.toMatchObject({ status: 404 });
  });
});
