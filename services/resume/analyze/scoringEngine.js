import {
  BREAKDOWN_WEIGHTS,
  LIMITS,
  SCORER_VERSION,
  SCORING_DELTAS,
  THRESHOLDS,
} from "./constants.js";
import {
  applyPenalty,
  applyReward,
  averageScores,
  clampScore,
  scoreFromChecks,
  scoreRatio,
  weightedMean,
} from "./scoringRules.js";
import {
  analyzeBullet,
  bulletHasPassivePhrase,
  collectBullets,
  countFilledFields,
  extractResumePlainText,
  hasNonEmptyText,
  isEntrySubstantiallyFilled,
  isBasicEmailFormat,
  isProfessionalEmail,
  isValidGitHubUrl,
  isValidLinkedInUrl,
  isValidProjectLink,
  normalizeToken,
  parseEducationScore,
  scoreDateRange,
  scoreEducationCgpa,
} from "./scoringUtils.js";

/**
 * @typedef {object} ResumePayload
 * @property {string} [templateId]
 * @property {object} [personal]
 * @property {object[]} [education]
 * @property {string[]} [skills]
 * @property {object[]} [projects]
 * @property {object[]} [experience]
 * @property {object[]} [certifications]
 * @property {object[]} [achievements]
 */

/**
 * @typedef {object} AnalyzeResumeResult
 * @property {number} overallScore
 * @property {{
 *   completeness: number,
 *   structure: number,
 *   bulletQuality: number,
 *   skills: number,
 *   professionalism: number,
 * }} breakdown
 * @property {AnalysisTip[]} tips
 * @property {string} scorerVersion
 * @property {boolean} interviewReady
 * @property {AnalysisTip[]} driveChecklist
 */

/**
 * @typedef {object} AnalysisTip
 * @property {string} id
 * @property {string} category
 * @property {"low"|"medium"|"high"} severity
 * @property {string} title
 * @property {string} message
 * @property {string} [action]
 * @property {string} [section]
 * @property {number} [estimatedDelta]
 * @property {"improvement"|"praise"} [kind]
 */

const PERSONAL_REQUIRED = ["fullName", "email"];
const PERSONAL_RECOMMENDED = ["phone", "location", "linkedin", "github", "summary"];
const EDUCATION_KEYS = ["institution", "degree", "field", "startDate", "endDate"];
const EXPERIENCE_KEYS = ["company", "role", "startDate", "endDate"];
const PROJECT_KEYS = ["name", "techStack", "startDate", "endDate"];

const SEVERITY_RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

/**
 * Deterministic ATS-style analysis. Pure function: no DB, no I/O, no mutation of input.
 * @param {ResumePayload} cleanPayload Sanitized resume payload (e.g. from sanitizeResumePayload).
 * @returns {AnalyzeResumeResult}
 */
export function analyzeResume(cleanPayload) {
  const payload = normalizePayload(cleanPayload);
  const resumeText = extractResumePlainText(payload);

  const completeness = scoreCompleteness(payload);
  const structure = scoreStructure(payload);
  const bulletQuality = scoreBulletQuality(payload);
  const skills = scoreSkills(payload, resumeText);
  const professionalism = scoreProfessionalism(payload);

  const breakdown = {
    completeness,
    structure,
    bulletQuality,
    skills,
    professionalism,
  };

  const overallScore = computeOverallScore(breakdown);
  const tips = buildTips(payload, breakdown);
  const { interviewReady, driveChecklist } = computeReadinessGates(overallScore, tips);

  return {
    overallScore,
    breakdown,
    tips,
    scorerVersion: SCORER_VERSION,
    interviewReady,
    driveChecklist,
  };
}

/**
 * @param {ResumePayload} payload
 * @returns {ResumePayload}
 */
function normalizePayload(payload) {
  return {
    templateId: payload?.templateId || "standard_ats",
    personal: payload?.personal && typeof payload.personal === "object" ? payload.personal : {},
    education: Array.isArray(payload?.education) ? payload.education : [],
    skills: Array.isArray(payload?.skills) ? payload.skills : [],
    projects: Array.isArray(payload?.projects) ? payload.projects : [],
    experience: Array.isArray(payload?.experience) ? payload.experience : [],
    certifications: Array.isArray(payload?.certifications) ? payload.certifications : [],
    achievements: Array.isArray(payload?.achievements) ? payload.achievements : [],
  };
}

/**
 * @param {ResumePayload} payload
 * @returns {number}
 */
function scoreCompleteness(payload) {
  const personal = payload.personal || {};
  let score = 100;

  for (const field of PERSONAL_REQUIRED) {
    if (!hasNonEmptyText(personal[field])) {
      score = applyPenalty(score, SCORING_DELTAS.missingRequiredField);
    }
  }

  const recommendedFilled = countFilledFields(personal, PERSONAL_RECOMMENDED);
  score = blendCompletenessRecommended(score, recommendedFilled, PERSONAL_RECOMMENDED.length);

  const summaryLen = String(personal.summary || "").trim().length;
  if (summaryLen === 0) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField * 2);
  } else if (summaryLen < 30) {
    score = applyPenalty(score, Math.round(SCORING_DELTAS.missingRecommendedField * 1.75));
  } else if (summaryLen < LIMITS.minSummaryChars) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  } else if (summaryLen >= LIMITS.idealSummaryChars) {
    score = applyReward(score, Math.round(SCORING_DELTAS.missingRecommendedField / 2));
  } else {
    score = applyReward(score, Math.round(SCORING_DELTAS.missingRecommendedField / 3));
  }

  const educationFilled = (payload.education || []).filter((entry) =>
    isEntrySubstantiallyFilled(entry, EDUCATION_KEYS)
  ).length;
  if (educationFilled === 0) {
    score = applyPenalty(score, SCORING_DELTAS.emptySection);
  } else {
    score = applyReward(score, 5);
  }

  // Penalize partially filled education rows (e.g. institution only).
  const weakEducationCount = (payload.education || []).filter((entry) => {
    const filled = countFilledFields(entry, EDUCATION_KEYS);
    return filled > 0 && filled < EDUCATION_KEYS.length;
  }).length;
  if (weakEducationCount > 0) {
    score = applyPenalty(score, Math.min(12, weakEducationCount * 3));
  }

  const educationEntries = payload.education || [];
  if (educationEntries.length > 0) {
    const cgpaScores = educationEntries.map((entry) => scoreEducationCgpa(entry?.score));
    score = averageScores([score, averageScores(cgpaScores)]);
    const missingCgpaCount = educationEntries.filter((entry) => {
      const parsed = parseEducationScore(entry?.score);
      return !parsed.valid;
    }).length;
    if (missingCgpaCount > 0) {
      score = applyPenalty(score, Math.min(14, missingCgpaCount * SCORING_DELTAS.missingCgpa));
    }
  }

  const skillCount = (payload.skills || []).filter(hasNonEmptyText).length;
  if (skillCount === 0) {
    score = applyPenalty(score, SCORING_DELTAS.emptySection);
  }

  const hasExperience = (payload.experience || []).some((entry) =>
    isEntrySubstantiallyFilled(entry, EXPERIENCE_KEYS)
  );
  const hasProjects = (payload.projects || []).some((entry) =>
    isEntrySubstantiallyFilled(entry, PROJECT_KEYS)
  );
  if (!hasExperience && !hasProjects) {
    score = applyPenalty(score, SCORING_DELTAS.emptySection);
  }

  const linkedin = personal.linkedin;
  const github = personal.github;
  if (!hasNonEmptyText(linkedin) && !hasNonEmptyText(github)) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  } else {
    if (hasNonEmptyText(linkedin) && !isValidLinkedInUrl(linkedin)) {
      score = applyPenalty(score, SCORING_DELTAS.invalidUrl);
    }
    if (hasNonEmptyText(github) && !isValidGitHubUrl(github)) {
      score = applyPenalty(score, SCORING_DELTAS.invalidUrl);
    }
  }

  return clampScore(score);
}

/**
 * @param {number} score
 * @param {number} filled
 * @param {number} total
 * @returns {number}
 */
function blendCompletenessRecommended(score, filled, total) {
  const ratio = scoreRatio(filled, total);
  if (ratio < 100) {
    const gap = 100 - ratio;
    return applyPenalty(score, Math.round((gap / 100) * SCORING_DELTAS.missingRecommendedField * 2));
  }
  return score;
}

/**
 * @param {ResumePayload} payload
 * @returns {number}
 */
function scoreStructure(payload) {
  const checks = [
    hasNonEmptyText(payload.personal?.fullName),
    hasNonEmptyText(payload.personal?.email),
    (payload.education || []).length > 0,
    (payload.skills || []).length > 0,
    (payload.experience || []).length > 0 || (payload.projects || []).length > 0,
  ];

  let score = scoreFromChecks(checks);

  const educationStructure = (payload.education || []).map((entry) => {
    const fieldScore = scoreRatio(countFilledFields(entry, EDUCATION_KEYS), EDUCATION_KEYS.length);
    const dateScore = scoreDateRange(entry.startDate, entry.endDate);
    return averageScores([fieldScore, dateScore]);
  });
  if (educationStructure.length > 0) {
    score = averageScores([score, averageScores(educationStructure)]);
  }

  const experienceStructure = (payload.experience || []).map((entry) => {
    const fieldScore = scoreRatio(countFilledFields(entry, EXPERIENCE_KEYS), EXPERIENCE_KEYS.length);
    const dateScore = scoreDateRange(entry.startDate, entry.endDate);
    const bulletCount = (entry.bullets || []).filter((b) => hasNonEmptyText(b?.text)).length;
    const bulletScore =
      bulletCount >= THRESHOLDS.minExperienceBulletsWhenPresent ? 100 : bulletCount > 0 ? 70 : 40;
    return averageScores([fieldScore, dateScore, bulletScore]);
  });

  const projectStructure = (payload.projects || []).map((entry) => {
    const fieldScore = scoreRatio(countFilledFields(entry, PROJECT_KEYS), PROJECT_KEYS.length);
    const dateScore = scoreDateRange(entry.startDate, entry.endDate);
    const bulletCount = (entry.bullets || []).filter((b) => hasNonEmptyText(b?.text)).length;
    const bulletScore =
      bulletCount >= THRESHOLDS.minProjectBulletsWhenPresent ? 100 : bulletCount > 0 ? 65 : 35;
    const linkScore = hasNonEmptyText(entry?.link)
      ? isValidProjectLink(entry.link)
        ? 100
        : 45
      : 50;
    const techScore = hasNonEmptyText(entry?.techStack) ? 100 : 45;
    return averageScores([fieldScore, dateScore, bulletScore, linkScore, techScore]);
  });

  const sectionScores = [...experienceStructure, ...projectStructure];
  if (sectionScores.length > 0) {
    score = averageScores([score, averageScores(sectionScores)]);
  }

  if ((payload.certifications || []).length > 0 || (payload.achievements || []).length > 0) {
    score = applyReward(score, 4);
  }

  return clampScore(score);
}

/**
 * @param {ResumePayload} payload
 * @returns {number}
 */
function scoreBulletQuality(payload) {
  const bullets = collectBullets(payload);
  if (bullets.length === 0) {
    return 35;
  }

  const bulletScores = bullets.map((bullet) => scoreSingleBullet(bullet.text));
  return averageScores(bulletScores);
}

/**
 * @param {string} text
 * @returns {number}
 */
function scoreSingleBullet(text) {
  const analysis = analyzeBullet(text);
  let score = 50;

  if (analysis.isWeak) {
    score = applyPenalty(score, SCORING_DELTAS.weakBullet);
  } else if (analysis.hasActionVerb && analysis.hasMetric) {
    score = applyReward(score, SCORING_DELTAS.strongBullet);
  }

  if (analysis.hasActionVerb) {
    score = applyReward(score, Math.round(SCORING_DELTAS.strongBullet / 2));
  }

  if (analysis.hasWeakVerb) {
    score = applyPenalty(score, Math.round(SCORING_DELTAS.weakBullet / 2));
  }

  if (analysis.hasPassivePhrase) {
    score = applyPenalty(score, SCORING_DELTAS.passiveBullet);
  }

  if (analysis.hasMetric) {
    score = applyReward(score, SCORING_DELTAS.bulletWithMetric);
  }

  if (analysis.idealLength) {
    score = applyReward(score, SCORING_DELTAS.bulletIdealLength);
  } else if (analysis.charCount > LIMITS.idealBulletMaxChars) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  } else if (analysis.wordCount < LIMITS.minBulletWords) {
    score = applyPenalty(score, SCORING_DELTAS.weakBullet / 2);
  }

  return clampScore(score);
}

/**
 * Contact polish, profile URLs, project links, and academic score presentation.
 * @param {ResumePayload} payload
 * @returns {number}
 */
function scoreProfessionalism(payload) {
  const personal = payload.personal || {};
  let score = 100;

  const email = String(personal.email || "").trim();
  if (!isBasicEmailFormat(email)) {
    score = applyPenalty(score, SCORING_DELTAS.missingRequiredField);
  } else if (!isProfessionalEmail(email)) {
    score = applyPenalty(score, SCORING_DELTAS.unprofessionalEmail);
  }

  const phone = String(personal.phone || "").replace(/\s/g, "");
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  }

  if (!hasNonEmptyText(personal.linkedin)) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  } else if (!isValidLinkedInUrl(personal.linkedin)) {
    score = applyPenalty(score, SCORING_DELTAS.invalidUrl);
  }

  if (!hasNonEmptyText(personal.github)) {
    score = applyPenalty(score, SCORING_DELTAS.missingRecommendedField);
  } else if (!isValidGitHubUrl(personal.github)) {
    score = applyPenalty(score, SCORING_DELTAS.invalidUrl);
  }

  const projects = payload.projects || [];
  if (projects.length > 0) {
    const projectScores = projects.map((project) => {
      const checks = [
        hasNonEmptyText(project?.name),
        hasNonEmptyText(project?.techStack),
        hasNonEmptyText(project?.link) && isValidProjectLink(project.link),
      ];
      return scoreFromChecks(checks);
    });
    score = averageScores([score, averageScores(projectScores)]);
  }

  const education = payload.education || [];
  if (education.length > 0) {
    const cgpaScores = education.map((entry) => scoreEducationCgpa(entry?.score));
    score = averageScores([score, averageScores(cgpaScores)]);
  }

  return clampScore(score);
}

/**
 * @param {ResumePayload} payload
 * @param {string} resumeText
 * @returns {number}
 */
function scoreSkills(payload, resumeText) {
  const skills = (payload.skills || []).map((s) => String(s).trim()).filter(Boolean);
  const count = skills.length;

  if (count === 0) return 0;

  let score = 100;

  if (count < THRESHOLDS.skillsSweetSpotMin) {
    score = applyPenalty(
      score,
      SCORING_DELTAS.skillBelowMin +
        (THRESHOLDS.skillsSweetSpotMin - count) * 2
    );
  } else if (count > THRESHOLDS.skillsSweetSpotMax) {
    score = applyPenalty(
      score,
      SCORING_DELTAS.skillAboveMax +
        Math.min(15, count - THRESHOLDS.skillsSweetSpotMax)
    );
  } else {
    score = applyReward(score, 5);
  }

  const normalizedSkills = skills.map(normalizeToken);
  const uniqueSkills = new Set(normalizedSkills);
  const duplicateCount = normalizedSkills.length - uniqueSkills.size;
  if (duplicateCount > 0) {
    score = applyPenalty(score, duplicateCount * SCORING_DELTAS.duplicateSkill);
  }

  const resumeLower = resumeText.toLowerCase();
  const skillsInBody = normalizedSkills.filter((skill) => skill && resumeLower.includes(skill)).length;
  const alignmentRatio = scoreRatio(skillsInBody, normalizedSkills.length);
  score = averageScores([score, alignmentRatio]);

  // Penalize skills that are listed but not demonstrated in resume text.
  const undemonstratedCount = normalizedSkills.filter((skill) => skill && !resumeLower.includes(skill)).length;
  if (undemonstratedCount > 0 && normalizedSkills.length > 0) {
    const undemRatio = undemonstratedCount / normalizedSkills.length;
    const penalty = Math.round(undemRatio * 12);
    score = applyPenalty(score, penalty);
  }

  const techStacks = [
    ...(payload.projects || []).map((p) => p?.techStack),
    ...(payload.experience || []).map((e) => e?.techStack),
  ]
    .filter(hasNonEmptyText)
    .join(" ")
    .toLowerCase();

  if (techStacks.length > 0) {
    const reflectedInStacks = normalizedSkills.filter((skill) => techStacks.includes(skill)).length;
    if (reflectedInStacks > 0) {
      score = applyReward(score, Math.min(10, reflectedInStacks * 2));
    }
  }

  return clampScore(score);
}

/**
 * @param {AnalyzeResumeResult["breakdown"]} breakdown
 * @returns {number}
 */
function computeOverallScore(breakdown) {
  return weightedMean([
    { score: breakdown.completeness, weight: BREAKDOWN_WEIGHTS.completeness },
    { score: breakdown.structure, weight: BREAKDOWN_WEIGHTS.structure },
    { score: breakdown.bulletQuality, weight: BREAKDOWN_WEIGHTS.bulletQuality },
    { score: breakdown.skills, weight: BREAKDOWN_WEIGHTS.skills },
    { score: breakdown.professionalism, weight: BREAKDOWN_WEIGHTS.professionalism },
  ]);
}

/**
 * @param {ResumePayload} payload
 * @param {AnalyzeResumeResult["breakdown"]} breakdown
 * @returns {AnalysisTip[]}
 */
function buildTips(payload, breakdown) {
  /** @type {AnalysisTip[]} */
  const tips = [];
  const seenIds = new Set();

  /** @param {AnalysisTip} tip */
  const pushTip = (tip) => {
    if (!tip || !tip.id) return;
    if (seenIds.has(tip.id)) return;
    seenIds.add(tip.id);
    tips.push({ kind: "improvement", ...tip });
  };

  /** Praise tips only when category score is genuinely strong (not “okay”). */
  const pushPraiseTip = (tip) => {
    if (!tip || !tip.id) return;
    if (seenIds.has(tip.id)) return;
    seenIds.add(tip.id);
    tips.push({ kind: "praise", ...tip });
  };

  const personal = payload.personal || {};
  const summaryLen = String(personal.summary || "").trim().length;
  const resumeLower = extractResumePlainText(payload).toLowerCase();

  const missingContacts = ["phone", "location", "linkedin", "github"]
    .filter((key) => !hasNonEmptyText(personal[key]))
    .slice(0, 6);

  if (breakdown.completeness < THRESHOLDS.tipTriggerScore) {
    if (missingContacts.length > 0) {
      pushTip({
        id: "contact-details",
        category: "completeness",
        severity: "medium",
        title: "Complete your contact details",
        message: `Your resume is missing: ${missingContacts.join(", ")}.`,
        action: "Fill in your contact section",
        section: "personal",
        estimatedDelta: 5,
      });
    }

    if (summaryLen === 0) {
      pushTip({
        id: "summary-missing",
        category: "completeness",
        severity: "medium",
        title: "Add a professional summary",
        message: "Your summary is empty. Add a short summary that matches your target role.",
        action: "Write your summary",
        section: "personal",
        estimatedDelta: 4,
      });
    } else if (summaryLen < LIMITS.minSummaryChars) {
      pushTip({
        id: "summary-too-short",
        category: "completeness",
        severity: "medium",
        title: "Strengthen your summary",
        message: `Your summary is only ${summaryLen} characters. Aim for 60–120 characters.`,
        action: "Expand your summary",
        section: "personal",
        estimatedDelta: 4,
      });
    }

    const weakEducationCount = (payload.education || []).filter((e) => {
      const filled = countFilledFields(e, EDUCATION_KEYS);
      return filled > 0 && filled < EDUCATION_KEYS.length;
    }).length;
    if (weakEducationCount > 0) {
      pushTip({
        id: "education-incomplete",
        category: "completeness",
        severity: "medium",
        title: "Complete education entries",
        message: `${weakEducationCount} education entr${weakEducationCount === 1 ? "y is" : "ies are"} missing degree/field/dates.`,
        action: "Fill degree/field/dates in Education",
        section: "education",
        estimatedDelta: 5,
      });
    }
  }

  const hasExperience = (payload.experience || []).some((e) =>
    isEntrySubstantiallyFilled(e, EXPERIENCE_KEYS)
  );
  const hasProjects = (payload.projects || []).some((p) =>
    isEntrySubstantiallyFilled(p, PROJECT_KEYS)
  );
  if (!hasExperience && !hasProjects) {
    pushTip({
      id: "no-experience-or-projects",
      category: "structure",
      severity: "high",
      title: "Add experience or projects",
      message: "Include at least one project or work experience section with concrete outcomes.",
      action: "Add a project or experience entry",
      section: "experience",
      estimatedDelta: 10,
    });
  }

  const bullets = collectBullets(payload);
  if (bullets.length === 0) {
    pushTip({
      id: "no-bullets",
      category: "bulletQuality",
      severity: "high",
      title: "Add impact bullets",
      message: "Add bullet points under Projects and/or Experience so your impact is visible.",
      action: "Create bullets in Projects/Experience",
      section: "experience",
      estimatedDelta: 10,
    });
  } else {
    let missingActionVerbCount = 0;
    let missingMetricCount = 0;
    let weakBulletCount = 0;
    let passiveBulletCount = 0;

    for (const b of bullets) {
      const a = analyzeBullet(b.text);
      if (!a.hasActionVerb) missingActionVerbCount += 1;
      if (!a.hasMetric) missingMetricCount += 1;
      if (a.isWeak || a.hasWeakVerb) weakBulletCount += 1;
      if (a.hasPassivePhrase || bulletHasPassivePhrase(b.text)) passiveBulletCount += 1;
    }

    if (missingActionVerbCount > 0) {
      pushTip({
        id: "bullet-action-verbs",
        category: "bulletQuality",
        severity: "medium",
        title: "Use stronger opening verbs",
        message: `${missingActionVerbCount} of ${bullets.length} bullets don’t start with an action verb.`,
        action: "Edit your experience bullets",
        section: "experience",
        estimatedDelta: 6,
      });
    }

    if (missingMetricCount > 0) {
      pushTip({
        id: "bullet-metrics",
        category: "bulletQuality",
        severity: "high",
        title: "Add measurable outcomes",
        message: `${missingMetricCount} of ${bullets.length} bullets don’t mention numbers/percentages/quantified impact.`,
        action: "Add metrics to bullets",
        section: "experience",
        estimatedDelta: 8,
      });
    }

    if (weakBulletCount > 0) {
      pushTip({
        id: "bullet-weak-openers",
        category: "bulletQuality",
        severity: "medium",
        title: "Rewrite weak or vague bullets",
        message: `${weakBulletCount} bullet${weakBulletCount === 1 ? "" : "s"} use weak verbs or vague phrasing (e.g. “helped with”, “worked on”).`,
        action: "Strengthen bullet wording",
        section: "experience",
        estimatedDelta: 5,
      });
    }

    if (passiveBulletCount > 0) {
      pushTip({
        id: "bullet-passive-voice",
        category: "bulletQuality",
        severity: "medium",
        title: "Use active voice in bullets",
        message: `${passiveBulletCount} bullet${passiveBulletCount === 1 ? "" : "s"} read passive (e.g. “was developed”, “were handled”).`,
        action: "Rewrite in active voice",
        section: "experience",
        estimatedDelta: 6,
      });
    }

    if (
      breakdown.bulletQuality >= THRESHOLDS.praiseTipMinScore &&
      weakBulletCount === 0 &&
      passiveBulletCount === 0 &&
      missingMetricCount === 0 &&
      missingActionVerbCount === 0
    ) {
      pushPraiseTip({
        id: "bullets-strong",
        category: "bulletQuality",
        severity: "low",
        title: "Bullets look strong",
        message: "Your bullets use active verbs and measurable outcomes consistently.",
      });
    }
  }

  const skills = (payload.skills || [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (skills.length > 0) {
    const normalizedSkills = skills.map(normalizeToken).filter(Boolean);
    const unique = [...new Set(normalizedSkills)];
    const undemonstrated = unique.filter((s) => !resumeLower.includes(s));
    if (undemonstrated.length > 0 && breakdown.skills < THRESHOLDS.tipTriggerScore) {
      pushTip({
        id: "skills-not-demonstrated",
        category: "skills",
        severity: "low",
        title: "Demonstrate your skills in bullets",
        message: `${undemonstrated.length} skill${undemonstrated.length === 1 ? "" : "s"} are listed but not demonstrated in resume text.`,
        action: "Mention these skills in Projects/Experience",
        section: "projects",
        estimatedDelta: 4,
      });
    }
  }

  if (breakdown.professionalism < THRESHOLDS.tipTriggerScore) {
    const email = String(personal.email || "").trim();
    if (hasNonEmptyText(email) && isBasicEmailFormat(email) && !isProfessionalEmail(email)) {
      pushTip({
        id: "email-unprofessional",
        category: "professionalism",
        severity: "medium",
        title: "Use an official email address",
        message:
          "Your email looks casual or nickname-style. Prefer a college ID (e.g. name@college.ac.in) or a simple name-based address (firstname.lastname@gmail.com).",
        action: "Update email in Personal",
        section: "personal",
        estimatedDelta: 5,
      });
    }

    if (hasNonEmptyText(personal.linkedin) && !isValidLinkedInUrl(personal.linkedin)) {
      pushTip({
        id: "linkedin-invalid",
        category: "professionalism",
        severity: "medium",
        title: "Fix your LinkedIn URL",
        message: "Use a full profile link like https://linkedin.com/in/your-name.",
        action: "Update LinkedIn link",
        section: "personal",
        estimatedDelta: 4,
      });
    }
    if (hasNonEmptyText(personal.github) && !isValidGitHubUrl(personal.github)) {
      pushTip({
        id: "github-invalid",
        category: "professionalism",
        severity: "medium",
        title: "Fix your GitHub URL",
        message: "Use a profile link like https://github.com/your-username.",
        action: "Update GitHub link",
        section: "personal",
        estimatedDelta: 4,
      });
    }
    if (!hasNonEmptyText(personal.linkedin) || !hasNonEmptyText(personal.github)) {
      pushTip({
        id: "profiles-missing",
        category: "professionalism",
        severity: "medium",
        title: "Add LinkedIn and GitHub profiles",
        message: "Recruiters expect both profile links on campus resumes.",
        action: "Add profile URLs",
        section: "personal",
        estimatedDelta: 5,
      });
    }

    const educationRows = payload.education || [];
    const missingCgpa = educationRows.filter((e) => !parseEducationScore(e?.score).valid).length;
    if (educationRows.length > 0 && missingCgpa > 0) {
      pushTip({
        id: "cgpa-missing",
        category: "professionalism",
        severity: "medium",
        title: "Add CGPA or percentage",
        message: `${missingCgpa} education entr${missingCgpa === 1 ? "y is" : "ies are"} missing a valid CGPA (e.g. 8.5/10) or percentage.`,
        action: "Fill score in Education",
        section: "education",
        estimatedDelta: 5,
      });
    }

    const projects = payload.projects || [];
    const missingTech = projects.filter((p) => !hasNonEmptyText(p?.techStack)).length;
    const missingLink = projects.filter(
      (p) => !hasNonEmptyText(p?.link) || !isValidProjectLink(p?.link)
    ).length;
    if (projects.length > 0 && missingTech > 0) {
      pushTip({
        id: "project-techstack",
        category: "professionalism",
        severity: "low",
        title: "Add tech stack to projects",
        message: `${missingTech} project${missingTech === 1 ? "" : "s"} missing technologies used.`,
        action: "Fill tech stack in Projects",
        section: "projects",
        estimatedDelta: 4,
      });
    }
    if (projects.length > 0 && missingLink > 0) {
      pushTip({
        id: "project-link",
        category: "professionalism",
        severity: "medium",
        title: "Add valid project links",
        message: `${missingLink} project${missingLink === 1 ? "" : "s"} missing a GitHub/demo URL.`,
        action: "Add project links",
        section: "projects",
        estimatedDelta: 5,
      });
    }
  }

  // Impact-ranked improvements first; praise tips only when truly strong.
  const improvements = tips.filter((t) => t.kind !== "praise");
  const praise = tips.filter((t) => t.kind === "praise");

  const orderedImprovements = improvements.sort((a, b) => {
    const da = Number.isFinite(a.estimatedDelta) ? a.estimatedDelta : 0;
    const db = Number.isFinite(b.estimatedDelta) ? b.estimatedDelta : 0;
    if (db !== da) return db - da;
    const sa = SEVERITY_RANK[a.severity] || 0;
    const sb = SEVERITY_RANK[b.severity] || 0;
    return sb - sa;
  });

  const cappedImprovements = orderedImprovements.slice(0, LIMITS.maxTips);
  const praiseSlot = Math.max(0, LIMITS.maxTips - cappedImprovements.length);
  const cappedPraise = praise.slice(0, praiseSlot);

  return [...cappedImprovements, ...cappedPraise];
}

/**
 * @param {number} overallScore
 * @param {AnalysisTip[]} tips
 * @returns {{ interviewReady: boolean, driveChecklist: AnalysisTip[] }}
 */
function computeReadinessGates(overallScore, tips) {
  const improvementTips = tips.filter((t) => t.kind !== "praise");
  const hasHighSeverity = improvementTips.some((t) => t.severity === "high");
  const interviewReady =
    overallScore >= THRESHOLDS.interviewReadyMinOverall && !hasHighSeverity;

  const driveChecklist = [...improvementTips]
    .sort((a, b) => {
      const da = Number.isFinite(a.estimatedDelta) ? a.estimatedDelta : 0;
      const db = Number.isFinite(b.estimatedDelta) ? b.estimatedDelta : 0;
      if (db !== da) return db - da;
      const sa = SEVERITY_RANK[a.severity] || 0;
      const sb = SEVERITY_RANK[b.severity] || 0;
      return sb - sa;
    })
    .slice(0, LIMITS.driveChecklistMax);

  return { interviewReady, driveChecklist };
}
