function sanitizeText(raw) {
  if (raw == null) return "";
  return String(raw).replace(/<[^>]*>/g, "").trim();
}

function sanitizeBulletList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ text: sanitizeText(item?.text) }))
    .filter((item) => item.text.length > 0);
}

export function sanitizeResumePayload(payload = {}) {
  const cleaned = {
    templateId: payload.templateId || "standard_ats",
    personal: {
      fullName: sanitizeText(payload.personal?.fullName),
      email: sanitizeText(payload.personal?.email),
      phone: sanitizeText(payload.personal?.phone),
      location: sanitizeText(payload.personal?.location),
      linkedin: sanitizeText(payload.personal?.linkedin),
      github: sanitizeText(payload.personal?.github),
      summary: sanitizeText(payload.personal?.summary),
    },
    education: (Array.isArray(payload.education) ? payload.education : []).map((item) => ({
      institution: sanitizeText(item?.institution),
      degree: sanitizeText(item?.degree),
      field: sanitizeText(item?.field),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      score: sanitizeText(item?.score),
      location: sanitizeText(item?.location),
    })),
    skills: (Array.isArray(payload.skills) ? payload.skills : [])
      .map((item) => sanitizeText(item))
      .filter(Boolean),
    projects: (Array.isArray(payload.projects) ? payload.projects : []).map((item) => ({
      name: sanitizeText(item?.name),
      techStack: sanitizeText(item?.techStack),
      link: sanitizeText(item?.link),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      bullets: sanitizeBulletList(item?.bullets),
    })),
    experience: (Array.isArray(payload.experience) ? payload.experience : []).map((item) => ({
      company: sanitizeText(item?.company),
      role: sanitizeText(item?.role),
      techStack: sanitizeText(item?.techStack),
      location: sanitizeText(item?.location),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      bullets: sanitizeBulletList(item?.bullets),
    })),
    certifications: (Array.isArray(payload.certifications) ? payload.certifications : []).map((item) => ({
      title: sanitizeText(item?.title),
      link: sanitizeText(item?.link ?? item?.detail),
    })),
    achievements: (Array.isArray(payload.achievements) ? payload.achievements : []).map((item) => ({
      title: sanitizeText(item?.title),
      detail: sanitizeText(item?.detail),
    })),
  };

  return cleaned;
}
