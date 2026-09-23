import { PREP_PATH_RESOURCE_CATALOG } from "../../config/prepPathResourceCatalog.js";
import { normalizeRoadmap } from "../../services/prepPath/generateRoadmap.js";
import {
  attachPrepPathResourceLinks,
  buildPrepPathResourceCatalogPrompt,
  normalizeResourceId,
  resolvePrepPathResourceById,
  resolvePrepPathSubtopicResource,
} from "../../services/prepPath/resourceCatalog.js";

describe("prepPath resource catalog", () => {
  it("resolves known resourceId to trusted URL", () => {
    const hit = resolvePrepPathResourceById("kotlin-docs");
    expect(hit?.url).toContain("kotlinlang.org");
    expect(hit?.title).toMatch(/Kotlin/i);
  });

  it("rejects unknown resourceId values", () => {
    expect(normalizeResourceId("not-a-real-resource")).toBe("");
    expect(resolvePrepPathResourceById("https://evil.example")).toBeNull();
  });

  it("prefers LLM resourceId over keyword fallback", () => {
    const resolved = resolvePrepPathSubtopicResource(
      { title: "Syntax & Types", resourceId: "kotlin-docs" },
      "Mobile development"
    );
    expect(resolved?.resourceId).toBe("kotlin-docs");
    expect(resolved?.url).toContain("kotlinlang.org");
  });

  it("falls back to keyword match when resourceId is missing", () => {
    const resolved = resolvePrepPathSubtopicResource(
      { title: "Arrays & hashing" },
      "DSA fundamentals"
    );
    expect(resolved?.resourceId).toBe("dsa-tuf");
  });

  it("includes all catalog ids in the LLM prompt block", () => {
    const block = buildPrepPathResourceCatalogPrompt();
    expect(block).toContain("kotlin-docs");
    expect(block).toContain("swift-docs");
    expect(block).toContain("dsa-tuf");
  });

  it("normalizes roadmap subtopics with validated resourceId", () => {
    const out = normalizeRoadmap(
      {
        topicSections: [
          {
            title: "Kotlin basics",
            why: "Android role prep",
            subtopics: [{ title: "Coroutines", resourceId: "kotlin-docs" }],
          },
        ],
        days: [{ day: 1, focus: "Kotlin basics", tasks: [{ title: "Study coroutines" }] }],
      },
      { days: 1, hoursPerDay: 2 }
    );

    const sub = out.topicSections[0].subtopics[0];
    expect(sub.resourceId).toBe("kotlin-docs");
    expect(sub.linkUrl).toContain("kotlinlang.org");
  });

  it("drops invalid LLM resourceId and uses keyword fallback", () => {
    const linked = attachPrepPathResourceLinks([
      {
        title: "Swift fundamentals",
        hours: 1,
        why: "",
        subtopics: [{ title: "Syntax & Types", hours: 1, notes: "", resourceId: "fake-swift-link" }],
      },
    ]);

    expect(linked[0].subtopics[0].resourceId).toBe("swift-docs");
    expect(linked[0].subtopics[0].linkUrl).toContain("swift.org");
  });

  it("uses live HTTPS URLs for every catalog entry", async () => {
    const failures = [];
    for (const entry of PREP_PATH_RESOURCE_CATALOG) {
      const res = await fetch(entry.url, { method: "GET", redirect: "follow" });
      if (res.status < 200 || res.status >= 400) {
        failures.push(`${entry.id} -> ${res.status} ${entry.url}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);

  it("covers mock interview round types with dedicated resources", () => {
    const roundExpectations = [
      ["SQL joins practice", "sql-gfg"],
      ["Machine learning basics", "ml-ai-gfg"],
      ["Embedded firmware", "embedded-gfg"],
      ["VLSI verilog design", "vlsi-gfg"],
      ["Case interview prep", "case-interview-gfg"],
      ["Project deep dive", "resume-projects-gfg"],
      ["DevOps docker kubernetes", "devops-gfg"],
      ["Low level design patterns", "lld-gfg"],
      ["QA automation testing", "testing-gfg"],
      ["Core technical revision", "core-technical-gfg"],
    ];

    for (const [text, expectedId] of roundExpectations) {
      const resolved = resolvePrepPathSubtopicResource({ title: text }, "Mock prep");
      expect(resolved?.resourceId).toBe(expectedId);
    }
  });
});
