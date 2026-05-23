import { PDFDocument, PDFString, rgb, StandardFonts } from "pdf-lib";
import { loadResumeIcons } from "./resumePdfIcons.js";

const SECTION_RULE_COLOR = rgb(0, 0, 0);
const ICON_SIZE = 9;
const ICON_GAP = 3;

const PAGE_SIZE = [612, 792];
const MARGIN_X = 54;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN_X * 2;

const IIITV = "iiitv_latex_style";

function splitLongToken(token, maxChars) {
  const value = String(token || "");
  if (value.length <= maxChars) return [value];
  const chunks = [];
  for (let i = 0; i < value.length; i += maxChars) {
    chunks.push(value.slice(i, i + maxChars));
  }
  return chunks;
}

function wrapText(text, maxChars = 96) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";
  for (const word of words) {
    for (const chunk of splitLongToken(word, maxChars)) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length > maxChars) {
        if (current) lines.push(current);
        current = chunk;
      } else {
        current = next;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
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

class PdfResumeBuilder {
  constructor(pdfDoc, { serif = false } = {}) {
    this.pdfDoc = pdfDoc;
    this.page = pdfDoc.addPage(PAGE_SIZE);
    this.y = PAGE_SIZE[1] - MARGIN_TOP;
    this.serif = serif;
    this.textColor = rgb(0, 0, 0);
    this.mutedColor = rgb(0.2, 0.2, 0.2);
    this._fontsReady = null;
    this.icons = {};
    this._iconsReady = null;
  }

  async initFonts() {
    if (this._fontsReady) return this._fontsReady;
    const regularName = this.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica;
    const boldName = this.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold;
    const italicName = this.serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique;

    this.fontRegular = await this.pdfDoc.embedFont(regularName);
    this.fontBold = await this.pdfDoc.embedFont(boldName);
    this.fontItalic = await this.pdfDoc.embedFont(italicName);
    this._fontsReady = true;
  }

  async initIcons() {
    if (this._iconsReady) return;
    this.icons = await loadResumeIcons(this.pdfDoc);
    this._iconsReady = true;
  }

  iconSlotWidth(iconKey) {
    return iconKey && this.icons?.[iconKey] ? ICON_SIZE + ICON_GAP : 0;
  }

  drawIconAt(iconKey, x, y, size = ICON_SIZE) {
    const image = this.icons?.[iconKey];
    if (!image) return;
    this.page.drawImage(image, {
      x,
      y: y - size + 2,
      width: size,
      height: size,
    });
  }

  drawLinkedText(x, y, text, { size = 10, font, url = null, underline = false } = {}) {
    const line = String(text || "").trim();
    if (!line) return 0;
    const useFont = font || this.fontRegular;
    this.page.drawText(line, { x, y, size, font: useFont, color: this.textColor });
    const width = this.textWidth(line, useFont, size);
    if (url) this.addUriLink(url, x, y, width, size + 2);
    if (underline && url) {
      this.page.drawLine({
        start: { x, y: y - 1 },
        end: { x: x + width, y: y - 1 },
        thickness: 0.25,
        color: this.textColor,
      });
    }
    return width;
  }

  drawSectionRule() {
    this.drawLine(MARGIN_X, this.y, PAGE_SIZE[0] - MARGIN_X, this.y, 0.5, SECTION_RULE_COLOR);
    this.y -= 6;
  }

  ensureSpace(needed = 14) {
    if (this.y - needed >= MARGIN_BOTTOM) return;
    this.page = this.pdfDoc.addPage(PAGE_SIZE);
    this.y = PAGE_SIZE[1] - MARGIN_TOP;
  }

  textWidth(text, font, size) {
    return font.widthOfTextAtSize(String(text || ""), size);
  }

  addUriLink(url, x, yBaseline, width, height = 12) {
    const uri = String(url || "").trim();
    if (!uri) return;
    const rectY = yBaseline - 2;
    const linkRef = this.pdfDoc.context.register(
      this.pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, rectY, x + width, rectY + height],
        Border: [0, 0, 0],
        A: {
          Type: "Action",
          S: "URI",
          URI: PDFString.of(uri),
        },
      })
    );
    this.page.node.addAnnot(linkRef);
  }

  drawLine(x1, y1, x2, y2, thickness = 0.15, color = null) {
    this.page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness,
      color: color || rgb(0.72, 0.72, 0.72),
    });
  }

  drawText(text, options = {}) {
    const line = String(text ?? "").trim();
    if (!line) return 0;

    const {
      size = 11,
      font = this.fontRegular,
      x = MARGIN_X,
      indent = 0,
      maxWidth = CONTENT_WIDTH,
      color = this.textColor,
      gapAfter = 0,
      linkUrl = null,
    } = options;
    const drawX = x + indent;

    this.ensureSpace(size + gapAfter + 4);
    this.page.drawText(line, { x: drawX, y: this.y, size, font, color, maxWidth: maxWidth - indent });
    const width = Math.min(this.textWidth(line, font, size), maxWidth - indent);
    if (linkUrl) {
      this.addUriLink(linkUrl, drawX, this.y, width, size + 2);
    }
    this.y -= size + 4 + gapAfter;
    return width;
  }

  drawWrapped(text, options = {}) {
    const maxChars = options.maxChars || 96;
    for (const line of wrapText(text, maxChars)) {
      this.drawText(line, options);
    }
  }

  drawTwoColumn({ left, right, leftFont, rightFont, size = 11, gapAfter = 0, rightLinkUrl = null }) {
    const leftText = String(left || "").trim();
    const rightText = String(right || "").trim();
    if (!leftText && !rightText) return;

    const lFont = leftFont || this.fontBold;
    const rFont = rightFont || this.fontRegular;
    this.ensureSpace(size + gapAfter + 4);
    const rowY = this.y;

    if (leftText) {
      this.page.drawText(leftText, {
        x: MARGIN_X,
        y: rowY,
        size,
        font: lFont,
        color: this.textColor,
        maxWidth: CONTENT_WIDTH * 0.72,
      });
    }
    if (rightText) {
      const rightWidth = this.textWidth(rightText, rFont, size);
      const rightX = PAGE_SIZE[0] - MARGIN_X - rightWidth;
      this.page.drawText(rightText, {
        x: rightX,
        y: rowY,
        size,
        font: rFont,
        color: this.textColor,
      });
      if (rightLinkUrl) {
        this.addUriLink(rightLinkUrl, rightX, rowY, rightWidth, size + 2);
      }
    }
    this.y -= size + 4 + gapAfter;
  }

  drawRightAlignedText(text, y, { size = 10, font, url = null, color = null } = {}) {
    const line = String(text || "").trim();
    if (!line) return;
    const useFont = font || this.fontRegular;
    const useColor = color || this.textColor;
    const width = this.textWidth(line, useFont, size);
    const x = PAGE_SIZE[0] - MARGIN_X - width;
    this.page.drawText(line, { x, y, size, font: useFont, color: useColor });
    if (url) this.addUriLink(url, x, y, width, size + 2);
  }

  drawSectionTitle(title) {
    this.y -= 8;
    const label = String(title || "").trim();
    const size = 11;
    this.ensureSpace(size + 12);
    this.page.drawText(label, {
      x: MARGIN_X,
      y: this.y,
      size,
      font: this.fontBold,
      color: this.textColor,
    });
    this.y -= size + 4;
    this.drawSectionRule();
  }

  drawBullets(bullets = [], options = {}) {
    const { size = 10, indent = 14 } = options;
    for (const bullet of bullets) {
      const text = String(bullet?.text || bullet || "").trim();
      if (!text) continue;
      this.drawWrapped(`• ${text}`, { size, indent, maxChars: 88 });
    }
  }

  drawRightAlignedRow(y, { text, iconKey = null, url = null, underline = false, size = 10 }) {
    const line = String(text || "").trim();
    if (!line) return;
    const font = this.fontRegular;
    const textW = this.textWidth(line, font, size);
    const iconSlot = this.iconSlotWidth(iconKey);
    const blockW = iconSlot + textW;
    let x = PAGE_SIZE[0] - MARGIN_X - blockW;
    if (iconSlot) {
      this.drawIconAt(iconKey, x, y, ICON_SIZE);
      x += iconSlot;
    }
    this.drawLinkedText(x, y, line, { size, font, url, underline: Boolean(url && underline) });
  }

  drawHeaderIIITV(personal = {}) {
    const name = String(personal.fullName || "Your Name").trim();
    const location = String(personal.location || "").trim();
    const nameSize = 22;
    const locationSize = 11;
    const contactSize = 10;
    const contactLineGap = 12;

    const contactLines = [];
    if (personal.phone) {
      contactLines.push({ text: personal.phone, iconKey: "phone", url: null, underline: false });
    }
    if (personal.email) {
      contactLines.push({
        text: String(personal.email).trim(),
        iconKey: "email",
        url: normalizeEmailUrl(personal.email),
        underline: true,
      });
    }
    const linkedinUrl = normalizeWebUrl(personal.linkedin);
    if (linkedinUrl) {
      contactLines.push({ text: "LinkedIn", iconKey: "linkedin", url: linkedinUrl, underline: true });
    }
    const githubUrl = normalizeWebUrl(personal.github);
    if (githubUrl) {
      contactLines.push({ text: "GitHub", iconKey: "github", url: githubUrl, underline: true });
    }

    const leftHeight = nameSize + (location ? locationSize + 6 : 0);
    const rightHeight = contactLines.length * contactLineGap;
    const headerHeight = Math.max(leftHeight, rightHeight) + 8;
    this.ensureSpace(headerHeight + 8);

    const headerTopY = this.y;
    this.page.drawText(name, {
      x: MARGIN_X,
      y: headerTopY,
      size: nameSize,
      font: this.fontBold,
      color: this.textColor,
    });

    if (location) {
      this.page.drawText(location, {
        x: MARGIN_X,
        y: headerTopY - nameSize - 5,
        size: locationSize,
        font: this.fontRegular,
        color: this.textColor,
      });
    }

    let contactY = headerTopY;
    for (const item of contactLines) {
      this.drawRightAlignedRow(contactY, { ...item, size: contactSize });
      contactY -= contactLineGap;
    }

    this.y = headerTopY - headerHeight;
  }

  drawCenteredText(text, options = {}) {
    const line = String(text ?? "").trim();
    if (!line) return;
    const size = options.size ?? 11;
    const font = options.font ?? this.fontRegular;
    const width = this.textWidth(line, font, size);
    const x = (PAGE_SIZE[0] - width) / 2;
    this.drawText(line, { ...options, x });
  }

  partWidthWithIcon(part, size) {
    const textW = this.textWidth(part.text, this.fontRegular, size);
    return this.iconSlotWidth(part.iconKey) + textW;
  }

  drawCenteredInlineParts(parts = [], { size = 10, gapAfter = 4 } = {}) {
    const visible = parts.filter((p) => String(p.text || "").trim());
    if (!visible.length) return;
    const sep = "  |  ";
    const sepW = this.textWidth(sep, this.fontRegular, size);
    const totalWidth = visible.reduce(
      (w, p, i) => w + (i > 0 ? sepW : 0) + this.partWidthWithIcon(p, size),
      0
    );
    let x = (PAGE_SIZE[0] - totalWidth) / 2;
    const rowY = this.y;
    this.ensureSpace(size + gapAfter + 4);
    for (let i = 0; i < visible.length; i += 1) {
      if (i > 0) {
        this.page.drawText(sep, { x, y: rowY, size, font: this.fontRegular, color: this.mutedColor });
        x += sepW;
      }
      const part = visible[i];
      const iconSlot = this.iconSlotWidth(part.iconKey);
      if (iconSlot) {
        this.drawIconAt(part.iconKey, x, rowY, ICON_SIZE);
        x += iconSlot;
      }
      x += this.drawLinkedText(x, rowY, part.text, {
        size,
        url: part.url,
        underline: part.underline,
      });
    }
    this.y = rowY - size - 4 - gapAfter;
  }

  drawInlineParts(parts = [], { size = 9, gapAfter = 2 } = {}) {
    const visible = parts.filter((p) => String(p.text || "").trim());
    if (!visible.length) return;
    const sep = " | ";
    let x = MARGIN_X;
    const rowY = this.y;
    this.ensureSpace(size + gapAfter + 4);
    for (let i = 0; i < visible.length; i += 1) {
      if (i > 0) {
        this.page.drawText(sep, { x, y: rowY, size, font: this.fontRegular, color: this.mutedColor });
        x += this.textWidth(sep, this.fontRegular, size);
      }
      const part = visible[i];
      const color = part.color || this.mutedColor;
      this.page.drawText(part.text, { x, y: rowY, size, font: this.fontRegular, color });
      const partWidth = this.textWidth(part.text, this.fontRegular, size);
      if (part.url) this.addUriLink(part.url, x, rowY, partWidth, size + 2);
      x += partWidth;
    }
    this.y = rowY - size - 4 - gapAfter;
  }

  drawSectionTitleStandard(title) {
    this.y -= 10;
    const label = String(title || "").trim().toUpperCase();
    const size = 11;
    this.ensureSpace(size + 12);
    this.page.drawText(label, {
      x: MARGIN_X,
      y: this.y,
      size,
      font: this.fontBold,
      color: rgb(0.35, 0.35, 0.35),
    });
    this.y -= size + 4;
    this.drawSectionRule();
  }

  drawHeaderStandard(personal = {}) {
    const name = personal.fullName || "Resume";
    const location = String(personal.location || "").trim();
    this.drawCenteredText(name, { size: 18, font: this.fontBold, gapAfter: location ? 4 : 8 });
    if (location) {
      this.drawCenteredText(location, { size: 10, font: this.fontRegular, color: this.mutedColor, gapAfter: 8 });
    }

    const contactParts = [];
    if (personal.phone) {
      contactParts.push({ text: String(personal.phone).trim(), iconKey: "phone" });
    }
    if (personal.email) {
      contactParts.push({
        text: String(personal.email).trim(),
        iconKey: "email",
        url: normalizeEmailUrl(personal.email),
        underline: true,
      });
    }
    if (personal.linkedin) {
      contactParts.push({
        text: "LinkedIn",
        iconKey: "linkedin",
        url: normalizeWebUrl(personal.linkedin),
        underline: true,
      });
    }
    if (personal.github) {
      contactParts.push({
        text: "GitHub",
        iconKey: "github",
        url: normalizeWebUrl(personal.github),
        underline: true,
      });
    }
    if (contactParts.length) {
      this.drawCenteredInlineParts(contactParts, { size: 9, gapAfter: 10 });
    }
  }

  drawSummary(summary, { standard = false } = {}) {
    const text = String(summary || "").trim();
    if (!text) return;
    if (standard) this.drawSectionTitleStandard("Summary");
    else this.drawSectionTitle("Summary");
    this.drawWrapped(text, { size: standard ? 11 : 10 });
  }

  drawEducation(entries = [], { iiitv = false } = {}) {
    if (!entries.length) return;
    if (iiitv) this.drawSectionTitle("Education");
    else this.drawSectionTitleStandard("Education");
    for (const entry of entries) {
      if (iiitv) {
        const dates = formatDateRange(entry.startDate, entry.endDate);
        const degreeLine = [entry.degree, entry.field].filter(Boolean).join(" - ");
        const subRight = [dates, entry.location].filter(Boolean).join("  |  ");
        this.drawTwoColumn({
          left: entry.institution,
          right: entry.score || dates,
          size: 11,
          gapAfter: 1,
        });
        this.drawTwoColumn({
          left: degreeLine,
          right: subRight,
          leftFont: this.fontItalic,
          rightFont: this.fontRegular,
          size: 10,
          gapAfter: 6,
        });
      } else {
        if (entry.institution) {
          this.drawText(entry.institution, { size: 12, font: this.fontBold, gapAfter: 2 });
        }
        const degreeLine = [entry.degree, entry.field].filter(Boolean).join(" - ");
        if (degreeLine) this.drawText(degreeLine, { size: 11, gapAfter: 2 });
        const meta = [formatDateRange(entry.startDate, entry.endDate), entry.score, entry.location]
          .filter(Boolean)
          .join(" | ");
        if (meta) this.drawText(meta, { size: 9, color: this.mutedColor, gapAfter: 8 });
      }
    }
  }

  drawExperience(entries = [], { iiitv = false } = {}) {
    if (!entries.length) return;
    if (iiitv) this.drawSectionTitle("Experience");
    else this.drawSectionTitleStandard("Experience");
    for (const entry of entries) {
      if (iiitv) {
        this.drawTwoColumn({
          left: entry.company,
          right: entry.location,
          size: 11,
          gapAfter: 1,
        });
        this.drawTwoColumn({
          left: entry.role,
          right: formatDateRange(entry.startDate, entry.endDate),
          leftFont: this.fontItalic,
          size: 10,
          gapAfter: 2,
        });
        this.drawBullets(entry.bullets, { size: 10 });
        this.y -= 4;
      } else {
        const heading = [entry.role, entry.company].filter(Boolean).join(" - ");
        if (heading) this.drawText(heading, { size: 12, font: this.fontBold, gapAfter: 2 });
        const meta = [formatDateRange(entry.startDate, entry.endDate), entry.location]
          .filter(Boolean)
          .join(" | ");
        if (meta) this.drawText(meta, { size: 9, color: this.mutedColor, gapAfter: 2 });
        this.drawBullets(entry.bullets, { size: 11 });
        this.y -= 4;
      }
    }
  }

  drawProjects(entries = [], { iiitv = false } = {}) {
    if (!entries.length) return;
    if (iiitv) this.drawSectionTitle("Projects");
    else this.drawSectionTitleStandard("Projects");
    for (const entry of entries) {
      if (iiitv) {
        this.drawTwoColumn({
          left: entry.name,
          right: formatDateRange(entry.startDate, entry.endDate),
          size: 11,
          gapAfter: 1,
        });
        const subLeft = entry.techStack ? entry.techStack : "";
        const linkUrl = normalizeWebUrl(entry.link);
        const subRight = linkUrl ? pickProjectLinkLabel(entry) : "";
        this.drawTwoColumn({
          left: subLeft,
          right: subRight,
          leftFont: this.fontItalic,
          size: 10,
          gapAfter: 1,
          rightLinkUrl: linkUrl,
        });
        this.drawBullets(entry.bullets, { size: 10 });
        this.y -= 4;
      } else {
        const heading = [entry.name, entry.techStack].filter(Boolean).join(" | ");
        if (heading) this.drawText(heading, { size: 12, font: this.fontBold, gapAfter: 2 });
        const linkUrl = normalizeWebUrl(entry.link);
        const metaParts = [];
        const dates = formatDateRange(entry.startDate, entry.endDate);
        if (dates) metaParts.push({ text: dates, color: this.mutedColor });
        if (linkUrl) {
          metaParts.push({
            text: pickProjectLinkLabel(entry),
            url: linkUrl,
            color: rgb(0.1, 0.2, 0.55),
          });
        }
        this.drawInlineParts(metaParts, { size: 9, gapAfter: 2 });
        this.drawBullets(entry.bullets, { size: 11 });
        this.y -= 4;
      }
    }
  }

  drawSkills(skills = [], { iiitv = false } = {}) {
    const title = iiitv ? "Technical Skills and Interests" : "Skills";
    if (iiitv) this.drawSectionTitle(title);
    else this.drawSectionTitleStandard(title);
    const skillsText = (skills || []).join(", ") || "—";
    this.drawWrapped(skillsText, { size: iiitv ? 10 : 11 });
  }

  drawTitledDetailSection(title, entries = [], { iiitv = false } = {}) {
    if (!entries.length) return;
    if (iiitv) this.drawSectionTitle(title);
    else this.drawSectionTitleStandard(title);
    if (iiitv) {
      this.drawBullets(
        entries.map((entry) => {
          const entryTitle = String(entry.title || "").trim();
          const detail = String(entry.detail || "").trim();
          if (entryTitle && detail) return `${entryTitle} - ${detail}`;
          return entryTitle || detail;
        }),
        { size: 10 }
      );
    } else {
      for (const entry of entries) {
        const entryTitle = String(entry.title || "").trim();
        const detail = String(entry.detail || "").trim();
        if (!entryTitle && !detail) continue;
        const line = entryTitle && detail ? `${entryTitle} - ${detail}` : entryTitle || detail;
        this.drawText(line, { size: 11, gapAfter: 4 });
      }
    }
  }
}

async function buildIIITVPdf(payload) {
  const pdfDoc = await PDFDocument.create();
  const builder = new PdfResumeBuilder(pdfDoc, { serif: true });
  await builder.initFonts();
  await builder.initIcons();

  const personal = payload.personal || {};
  builder.drawHeaderIIITV(personal);
  builder.drawSummary(personal.summary);
  builder.drawEducation(payload.education || [], { iiitv: true });
  builder.drawExperience(payload.experience || [], { iiitv: true });
  builder.drawProjects(payload.projects || [], { iiitv: true });
  builder.drawSkills(payload.skills || [], { iiitv: true });
  builder.drawTitledDetailSection("Certifications", payload.certifications || [], { iiitv: true });
  builder.drawTitledDetailSection("Achievements", payload.achievements || [], { iiitv: true });

  return Buffer.from(await pdfDoc.save({ useObjectStreams: true }));
}

async function buildStandardPdf(payload) {
  const pdfDoc = await PDFDocument.create();
  const builder = new PdfResumeBuilder(pdfDoc, { serif: false });
  await builder.initFonts();
  await builder.initIcons();

  const personal = payload.personal || {};
  builder.drawHeaderStandard(personal);
  builder.drawSummary(personal.summary, { standard: true });
  builder.drawEducation(payload.education || []);
  builder.drawSkills(payload.skills || []);
  builder.drawProjects(payload.projects || []);
  builder.drawExperience(payload.experience || []);
  builder.drawTitledDetailSection("Certifications", payload.certifications || []);
  builder.drawTitledDetailSection("Achievements", payload.achievements || []);

  return Buffer.from(await pdfDoc.save({ useObjectStreams: true }));
}

export async function buildPdfBufferFromResume(payload = {}) {
  const templateId = String(payload.templateId || "standard_ats").trim();
  if (templateId === IIITV) {
    return buildIIITVPdf(payload);
  }
  return buildStandardPdf(payload);
}
