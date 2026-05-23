import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  ImageRun,
  Packer,
  Paragraph,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  convertInchesToTwip,
} from "docx";
import { loadResumeContactIconBuffers } from "./resumeContactIcons.js";

const LINK_COLOR = "0563C1";
const CONTACT_ICON_PX = 11;

const IIITV = "iiitv_latex_style";
const SERIF = "Times New Roman";
const BODY_SIZE = 26; // 13pt
const SMALL_SIZE = 24; // 12pt
const NAME_SIZE = 48; // 24pt
const SECTION_TITLE_SIZE = 28; // 14pt

/** Page margins (twips). Default library top is 1"; we use a tighter top for resumes. */
const PAGE_MARGINS = {
  top: convertInchesToTwip(0.5),
  right: convertInchesToTwip(1),
  bottom: convertInchesToTwip(1),
  left: convertInchesToTwip(1),
};

function createResumeDocument(children) {
  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: PAGE_MARGINS,
          },
        },
        children,
      },
    ],
  });
}

function formatDateRange(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (start && end) return `${start} – ${end}`;
  return start || end || "";
}

function normalizeWebUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw;
  return `https://${raw.replace(/^\/\//, "")}`;
}

function normalizeEmailUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const email = raw.replace(/^mailto:/i, "");
  return `mailto:${email}`;
}

function pickProjectLinkLabel(entry = {}) {
  const url = normalizeWebUrl(entry.link);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("github.com")) return "GitHub";
    if (host.includes("gitlab.com")) return "GitLab";
    if (host.includes("bitbucket.org")) return "Bitbucket";
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && (host.includes("github") || host.includes("gitlab"))) {
      return segments[1];
    }
    if (segments.length) return segments[segments.length - 1];
    return "Link";
  } catch {
    return "Link";
  }
}

function noTableBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };
}

function textRun(text, options = {}) {
  return new TextRun({
    text: String(text || ""),
    font: options.font || SERIF,
    size: options.size || BODY_SIZE,
    bold: options.bold || false,
    italics: options.italics || false,
    smallCaps: options.smallCaps || false,
  });
}

function hyperlinkRun(text, url, options = {}) {
  if (!url) return textRun(text, options);
  const size = options.size || BODY_SIZE;
  return new ExternalHyperlink({
    link: url,
    children: [
      new TextRun({
        text: String(text || ""),
        font: SERIF,
        size,
        bold: options.bold || false,
        italics: options.italics || false,
        style: "Hyperlink",
        color: LINK_COLOR,
        underline: { type: UnderlineType.SINGLE, color: LINK_COLOR },
      }),
    ],
  });
}

function paragraphFromChildren(children, spacing = { after: 60 }) {
  if (!children.length) return null;
  return new Paragraph({ children, spacing });
}

function contactIconRun(iconBuffers, iconKey) {
  const data = iconBuffers?.[iconKey];
  if (!data) return null;
  return new ImageRun({
    type: "png",
    data,
    transformation: {
      width: CONTACT_ICON_PX,
      height: CONTACT_ICON_PX,
    },
  });
}

function appendContactIcon(children, iconBuffers, iconKey) {
  const icon = contactIconRun(iconBuffers, iconKey);
  if (!icon) return;
  children.push(icon);
  children.push(textRun(" ", { size: BODY_SIZE }));
}

function buildStandardContactParagraph(personal, iconBuffers = {}) {
  const children = [];
  const addSeparator = () => {
    if (children.length) children.push(textRun("  |  ", { size: BODY_SIZE }));
  };

  if (personal.phone) {
    addSeparator();
    appendContactIcon(children, iconBuffers, "phone");
    children.push(textRun(personal.phone, { size: BODY_SIZE }));
  }
  if (personal.email) {
    const email = String(personal.email).trim();
    if (email) {
      addSeparator();
      appendContactIcon(children, iconBuffers, "email");
      children.push(hyperlinkRun(email, normalizeEmailUrl(email), { size: BODY_SIZE }));
    }
  }
  const linkedinUrl = normalizeWebUrl(personal.linkedin);
  if (linkedinUrl) {
    addSeparator();
    appendContactIcon(children, iconBuffers, "linkedin");
    children.push(hyperlinkRun("LinkedIn", linkedinUrl, { size: BODY_SIZE }));
  }
  const githubUrl = normalizeWebUrl(personal.github);
  if (githubUrl) {
    addSeparator();
    appendContactIcon(children, iconBuffers, "github");
    children.push(hyperlinkRun("GitHub", githubUrl, { size: BODY_SIZE }));
  }

  if (!children.length) return null;
  return new Paragraph({
    children,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  });
}

function certificationBulletParagraph(item) {
  const title = String(item.title || "").trim();
  if (!title) return null;
  const url = normalizeWebUrl(item.link);
  const children = url
    ? [hyperlinkRun(title, url, { bold: true })]
    : [textRun(title, { bold: true })];
  return new Paragraph({
    children,
    bullet: { level: 0 },
    spacing: { after: 40 },
  });
}

function createStandardSectionTitle(title) {
  return new Paragraph({
    children: [textRun(title, { bold: true, size: SECTION_TITLE_SIZE })],
    border: {
      bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { after: 150, before: 100 },
  });
}

function createIIITVSectionTitle(title) {
  return new Paragraph({
    children: [textRun(title, { bold: true, smallCaps: true, size: SECTION_TITLE_SIZE })],
    border: {
      bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { after: 150, before: 100 },
  });
}

function twoColumnRow(
  left,
  right,
  { leftBold = false, leftItalic = false, rightItalic = false, rightLinkUrl = null } = {}
) {
  const rightNode =
    rightLinkUrl && right
      ? hyperlinkRun(right, rightLinkUrl, { italics: rightItalic, size: BODY_SIZE })
      : textRun(right, { italics: rightItalic, size: BODY_SIZE });

  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(7.0) }],
    children: [
      textRun(left, { bold: leftBold, italics: leftItalic, size: BODY_SIZE }),
      new TextRun({ text: "\t", font: SERIF }),
      rightNode,
    ],
    spacing: { after: 40 },
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    children: [textRun(text, { size: BODY_SIZE })],
    bullet: { level: 0 },
    spacing: { after: 40 },
  });
}

function buildStandardDocFromResume(payload = {}, iconBuffers = {}) {
  const personal = payload.personal || {};
  const education = payload.education || [];
  const experience = payload.experience || [];
  const projects = payload.projects || [];
  const skills = payload.skills || [];
  const certifications = payload.certifications || [];
  const achievements = payload.achievements || [];
  const sections = [];

  sections.push(
    new Paragraph({
      children: [textRun(personal.fullName || "Your Name", { bold: true, size: NAME_SIZE })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
    })
  );

  if (personal.location) {
    sections.push(
      new Paragraph({
        children: [textRun(personal.location, { size: BODY_SIZE })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      })
    );
  }

  const contactParagraph = buildStandardContactParagraph(personal, iconBuffers);
  if (contactParagraph) sections.push(contactParagraph);

  if (personal.summary) {
    sections.push(createStandardSectionTitle("SUMMARY"));
    sections.push(
      new Paragraph({
        children: [textRun(personal.summary)],
        spacing: { after: 200 },
      })
    );
  }

  if (education.length > 0) {
    sections.push(createStandardSectionTitle("EDUCATION"));
    for (const item of education) {
      sections.push(
        new Paragraph({
          children: [textRun(item.institution || "Institution", { bold: true })],
          spacing: { after: 40 },
        })
      );
      const degree = [item.degree, item.field].filter(Boolean).join(" - ");
      if (degree) {
        sections.push(new Paragraph({ children: [textRun(degree)], spacing: { after: 40 } }));
      }
      const meta = [formatDateRange(item.startDate, item.endDate), item.score, item.location]
        .filter(Boolean)
        .join(" | ");
      if (meta) {
        sections.push(new Paragraph({ children: [textRun(meta, { size: SMALL_SIZE })], spacing: { after: 120 } }));
      }
    }
  }

  if (skills.length > 0) {
    sections.push(createStandardSectionTitle("SKILLS"));
    sections.push(
      new Paragraph({
        children: [textRun(skills.join(", "))],
        spacing: { after: 200 },
      })
    );
  }

  if (projects.length > 0) {
    sections.push(createStandardSectionTitle("PROJECTS"));
    for (const item of projects) {
      const heading = [item.name, item.techStack].filter(Boolean).join(" | ");
      sections.push(
        new Paragraph({
          children: [textRun(heading, { bold: true })],
          spacing: { after: 40 },
        })
      );
      const dates = formatDateRange(item.startDate, item.endDate);
      const projectUrl = normalizeWebUrl(item.link);
      const linkLabel = projectUrl ? pickProjectLinkLabel(item) : "";
      const metaChildren = [];
      if (dates) metaChildren.push(textRun(dates, { size: SMALL_SIZE }));
      if (projectUrl && linkLabel) {
        if (metaChildren.length) metaChildren.push(textRun(" | ", { size: SMALL_SIZE }));
        metaChildren.push(hyperlinkRun(linkLabel, projectUrl, { size: SMALL_SIZE }));
      }
      const projectMeta = paragraphFromChildren(metaChildren, { after: 60 });
      if (projectMeta) sections.push(projectMeta);
      for (const bullet of item.bullets || []) {
        if (bullet.text) sections.push(bulletParagraph(bullet.text));
      }
    }
  }

  if (experience.length > 0) {
    sections.push(createStandardSectionTitle("EXPERIENCE"));
    for (const item of experience) {
      const heading = [item.role, item.company].filter(Boolean).join(" - ");
      sections.push(
        new Paragraph({
          children: [textRun(heading, { bold: true })],
          spacing: { after: 40 },
        })
      );
      const meta = [formatDateRange(item.startDate, item.endDate), item.location].filter(Boolean).join(" | ");
      if (meta) {
        sections.push(new Paragraph({ children: [textRun(meta, { size: SMALL_SIZE })], spacing: { after: 40 } }));
      }
      if (item.techStack) {
        sections.push(
          new Paragraph({
            children: [textRun(item.techStack, { italics: true, size: BODY_SIZE })],
            spacing: { after: 60 },
          })
        );
      }
      for (const bullet of item.bullets || []) {
        if (bullet.text) sections.push(bulletParagraph(bullet.text));
      }
    }
  }

  if (certifications.length > 0) {
    sections.push(createStandardSectionTitle("CERTIFICATIONS"));
    for (const item of certifications) {
      const certPara = certificationBulletParagraph(item);
      if (certPara) sections.push(certPara);
    }
  }

  if (achievements.length > 0) {
    sections.push(createStandardSectionTitle("ACHIEVEMENTS"));
    for (const item of achievements) {
      const line = [item.title, item.detail].filter(Boolean).join(" - ");
      if (line) sections.push(bulletParagraph(line));
    }
  }

  return createResumeDocument(sections);
}

function rightAlignedParagraph(children) {
  return new Paragraph({
    children,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 30 },
  });
}

function buildIIITVHeaderTable(personal, iconBuffers = {}) {
  const leftParas = [
    new Paragraph({
      children: [textRun(personal.fullName || "Your Name", { bold: true, size: NAME_SIZE })],
      spacing: { before: 0, after: 60 },
    }),
  ];
  if (personal.location) {
    leftParas.push(
      new Paragraph({
        children: [textRun(personal.location, { size: BODY_SIZE })],
        spacing: { after: 0 },
      })
    );
  }

  const rightContactRow = (iconKey, ...runs) => {
    const children = [];
    appendContactIcon(children, iconBuffers, iconKey);
    children.push(...runs);
    return rightAlignedParagraph(children);
  };

  const rightParas = [];
  if (personal.phone) {
    rightParas.push(rightContactRow("phone", textRun(personal.phone, { size: BODY_SIZE })));
  }
  if (personal.email) {
    const email = String(personal.email).trim();
    rightParas.push(
      rightContactRow("email", hyperlinkRun(email, normalizeEmailUrl(email)))
    );
  }
  const linkedinUrl = normalizeWebUrl(personal.linkedin);
  if (linkedinUrl) {
    rightParas.push(rightContactRow("linkedin", hyperlinkRun("LinkedIn", linkedinUrl)));
  }
  const githubUrl = normalizeWebUrl(personal.github);
  if (githubUrl) {
    rightParas.push(rightContactRow("github", hyperlinkRun("GitHub", githubUrl)));
  }
  if (!rightParas.length) {
    rightParas.push(new Paragraph({ children: [textRun("")] }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noTableBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            borders: noTableBorders(),
            children: leftParas,
          }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            borders: noTableBorders(),
            children: rightParas,
          }),
        ],
      }),
    ],
  });
}

function buildIIITVDocFromResume(payload = {}, iconBuffers = {}) {
  const personal = payload.personal || {};
  const education = payload.education || [];
  const experience = payload.experience || [];
  const projects = payload.projects || [];
  const skills = payload.skills || [];
  const certifications = payload.certifications || [];
  const achievements = payload.achievements || [];
  const sections = [];

  sections.push(buildIIITVHeaderTable(personal, iconBuffers));
  sections.push(new Paragraph({ children: [textRun("")], spacing: { after: 120 } }));

  if (personal.summary) {
    sections.push(createIIITVSectionTitle("Summary"));
    sections.push(
      new Paragraph({
        children: [textRun(personal.summary)],
        spacing: { after: 200 },
      })
    );
  }

  if (education.length > 0) {
    sections.push(createIIITVSectionTitle("Education"));
    for (const item of education) {
      const dates = formatDateRange(item.startDate, item.endDate);
      const degreeLine = [item.degree, item.field].filter(Boolean).join(" - ");
      const subRight = [dates, item.location].filter(Boolean).join("  |  ");
      sections.push(twoColumnRow(item.institution, item.score || dates, { leftBold: true }));
      sections.push(twoColumnRow(degreeLine, subRight, { leftItalic: true }));
      sections.push(new Paragraph({ children: [textRun("")], spacing: { after: 60 } }));
    }
  }

  if (experience.length > 0) {
    sections.push(createIIITVSectionTitle("Experience"));
    for (const item of experience) {
      sections.push(twoColumnRow(item.company, item.location, { leftBold: true }));
      sections.push(
        twoColumnRow(item.role, formatDateRange(item.startDate, item.endDate), { leftItalic: true })
      );
      if (item.techStack) {
        sections.push(twoColumnRow(item.techStack, "", { leftItalic: true }));
      }
      for (const bullet of item.bullets || []) {
        if (bullet.text) sections.push(bulletParagraph(bullet.text));
      }
      sections.push(new Paragraph({ children: [textRun("")], spacing: { after: 60 } }));
    }
  }

  if (projects.length > 0) {
    sections.push(createIIITVSectionTitle("Projects"));
    for (const item of projects) {
      const dates = formatDateRange(item.startDate, item.endDate);
      const projectUrl = normalizeWebUrl(item.link);
      const linkLabel = projectUrl ? pickProjectLinkLabel(item) : "";
      sections.push(twoColumnRow(item.name, dates, { leftBold: true }));
      sections.push(
        twoColumnRow(item.techStack, linkLabel, {
          leftItalic: true,
          rightLinkUrl: projectUrl,
        })
      );
      for (const bullet of item.bullets || []) {
        if (bullet.text) sections.push(bulletParagraph(bullet.text));
      }
      sections.push(new Paragraph({ children: [textRun("")], spacing: { after: 60 } }));
    }
  }

  if (skills.length > 0) {
    sections.push(createIIITVSectionTitle("Technical Skills and Interests"));
    sections.push(
      new Paragraph({
        children: [textRun(skills.join(", "))],
        spacing: { after: 200 },
      })
    );
  }

  if (certifications.length > 0) {
    sections.push(createIIITVSectionTitle("Certifications"));
    for (const item of certifications) {
      const certPara = certificationBulletParagraph(item);
      if (certPara) sections.push(certPara);
    }
  }

  if (achievements.length > 0) {
    sections.push(createIIITVSectionTitle("Achievements"));
    for (const item of achievements) {
      const line = [item.title, item.detail].filter(Boolean).join(" - ");
      if (line) sections.push(bulletParagraph(line));
    }
  }

  return createResumeDocument(sections);
}

export async function buildDocxBufferFromResume(payload = {}) {
  try {
    const iconBuffers = await loadResumeContactIconBuffers();
    const templateId = String(payload.templateId || "standard_ats").trim();
    const doc =
      templateId === IIITV
        ? buildIIITVDocFromResume(payload, iconBuffers)
        : buildStandardDocFromResume(payload, iconBuffers);
    return await Packer.toBuffer(doc);
  } catch (error) {
    console.error("[resume] docx generation error", error);
    throw new Error("Failed to generate Word document");
  }
}
