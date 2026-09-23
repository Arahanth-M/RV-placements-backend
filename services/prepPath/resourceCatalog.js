import { PREP_PATH_RESOURCE_CATALOG } from "../../config/prepPathResourceCatalog.js";

const BY_ID = new Map(
  PREP_PATH_RESOURCE_CATALOG.map((entry) => [entry.id, entry])
);

export function listPrepPathResourceIds() {
  return PREP_PATH_RESOURCE_CATALOG.map((entry) => entry.id);
}

export function buildPrepPathResourceCatalogPrompt() {
  return PREP_PATH_RESOURCE_CATALOG.map(
    (entry) => `- ${entry.id}: ${entry.summary}`
  ).join("\n");
}

export function normalizeResourceId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return BY_ID.has(id) ? id : "";
}

export function resolvePrepPathResourceById(resourceId) {
  const id = normalizeResourceId(resourceId);
  if (!id) return null;
  const entry = BY_ID.get(id);
  if (!entry) return null;
  return {
    resourceId: entry.id,
    title: entry.title,
    url: entry.url,
    why: entry.why,
  };
}

function pickResourceFromBlob(blob) {
  const text = String(blob || "").toLowerCase().trim();
  if (!text) return null;

  const segments = text
    .split(/[+/,;&|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const segment of segments.length ? segments : [text]) {
    for (const entry of PREP_PATH_RESOURCE_CATALOG) {
      if (entry.keys.some((key) => segment.includes(key))) {
        return entry;
      }
    }
  }

  for (const entry of PREP_PATH_RESOURCE_CATALOG) {
    if (entry.keys.some((key) => text.includes(key))) {
      return entry;
    }
  }
  return null;
}

export function pickPrepPathResourceByText(...parts) {
  const chunks = parts.map((part) => String(part || "").trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; i += 1) {
    const hit = pickResourceFromBlob(chunks[i]);
    if (hit) {
      return {
        resourceId: hit.id,
        title: hit.title,
        url: hit.url,
        why: hit.why,
      };
    }
  }
  const blob = chunks.join(" ").toLowerCase();
  const hit = pickResourceFromBlob(blob);
  if (!hit) return null;
  return {
    resourceId: hit.id,
    title: hit.title,
    url: hit.url,
    why: hit.why,
  };
}

export function resolvePrepPathSubtopicResource(sub, topicTitle = "") {
  const fromId = resolvePrepPathResourceById(sub?.resourceId);
  if (fromId) return fromId;

  return pickPrepPathResourceByText(
    sub?.title,
    sub?.notes,
    topicTitle,
    sub?.topicTitle
  );
}

export function attachPrepPathResourceLinks(topicSections) {
  return (Array.isArray(topicSections) ? topicSections : []).map((topic) => {
    const topicResource = pickPrepPathResourceByText(topic.title, topic.why);
    const subtopics = (Array.isArray(topic.subtopics) ? topic.subtopics : []).map((sub) => {
      const resolved = resolvePrepPathSubtopicResource(sub, topic.title);
      return {
        ...sub,
        resourceId: resolved?.resourceId || "",
        linkTitle: resolved?.title || "",
        linkUrl: resolved?.url || "",
        linkWhy: resolved?.why || "",
      };
    });

    if (!subtopics.length) {
      return {
        ...topic,
        subtopics: [
          {
            title: "Core practice",
            hours: topic.hours || 1,
            notes: "",
            resourceId: topicResource?.resourceId || "",
            linkTitle: topicResource?.title || "",
            linkUrl: topicResource?.url || "",
            linkWhy: topicResource?.why || "",
          },
        ],
      };
    }

    return { ...topic, subtopics };
  });
}
