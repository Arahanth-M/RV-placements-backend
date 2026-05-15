import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_SIZE = [612, 792];
const MARGIN_X = 48;
const MARGIN_BOTTOM = 48;
const LINE_HEIGHT = 14;

function wrapText(text, maxChars = 92) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
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

export async function buildPdfBufferFromResume(payload = {}) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textColor = rgb(0.12, 0.12, 0.12);
  const mutedColor = rgb(0.35, 0.35, 0.35);

  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN_X;

  const ensureSpace = (needed = LINE_HEIGHT) => {
    if (y - needed >= MARGIN_BOTTOM) return;
    page = pdfDoc.addPage(PAGE_SIZE);
    y = PAGE_SIZE[1] - MARGIN_X;
  };

  const drawTextLine = (text, options = {}) => {
    const {
      size = 11,
      font = fontRegular,
      indent = 0,
      color = textColor,
      gapAfter = 0,
    } = options;
    const line = String(text || "").trim();
    if (!line) return;
    ensureSpace(LINE_HEIGHT + gapAfter);
    page.drawText(line, {
      x: MARGIN_X + indent,
      y,
      size,
      font,
      color,
    });
    y -= LINE_HEIGHT + gapAfter;
  };

  const drawWrapped = (text, options = {}) => {
    for (const line of wrapText(text)) {
      drawTextLine(line, options);
    }
  };

  const drawSectionTitle = (title) => {
    ensureSpace(LINE_HEIGHT * 2);
    y -= 6;
    drawTextLine(title.toUpperCase(), {
      size: 10,
      font: fontBold,
      gapAfter: 4,
    });
  };

  const personal = payload.personal || {};
  drawTextLine(personal.fullName || "Resume", {
    size: 20,
    font: fontBold,
    gapAfter: 6,
  });

  const contact = [personal.email, personal.phone, personal.location]
    .filter(Boolean)
    .join("  |  ");
  if (contact) drawTextLine(contact, { size: 10, color: mutedColor, gapAfter: 2 });

  const links = [personal.linkedin, personal.github].filter(Boolean).join("  |  ");
  if (links) drawTextLine(links, { size: 9, color: mutedColor, gapAfter: 10 });

  if (personal.summary) {
    drawSectionTitle("Summary");
    drawWrapped(personal.summary, { size: 10 });
  }

  if ((payload.education || []).length > 0) {
    drawSectionTitle("Education");
    for (const entry of payload.education) {
      const heading = [entry.institution, entry.degree, entry.field].filter(Boolean).join(" — ");
      if (heading) drawTextLine(heading, { size: 11, font: fontBold, gapAfter: 2 });
      const meta = [
        formatDateRange(entry.startDate, entry.endDate),
        entry.score,
        entry.location,
      ]
        .filter(Boolean)
        .join("  |  ");
      if (meta) drawTextLine(meta, { size: 9, color: mutedColor, gapAfter: 6 });
    }
  }

  drawSectionTitle("Skills");
  const skillsText = (payload.skills || []).join(", ") || "—";
  drawWrapped(skillsText, { size: 10 });

  if ((payload.projects || []).length > 0) {
    drawSectionTitle("Projects");
    for (const entry of payload.projects) {
      const heading = [entry.name, entry.techStack].filter(Boolean).join("  |  ");
      if (heading) drawTextLine(heading, { size: 11, font: fontBold, gapAfter: 2 });
      const meta = [formatDateRange(entry.startDate, entry.endDate), entry.link]
        .filter(Boolean)
        .join("  |  ");
      if (meta) drawTextLine(meta, { size: 9, color: mutedColor, gapAfter: 2 });
      for (const bullet of entry.bullets || []) {
        drawTextLine(`• ${bullet.text}`, { size: 10, indent: 10, gapAfter: 2 });
      }
      y -= 4;
    }
  }

  if ((payload.experience || []).length > 0) {
    drawSectionTitle("Experience");
    for (const entry of payload.experience) {
      const heading = [entry.role, entry.company].filter(Boolean).join(" — ");
      if (heading) drawTextLine(heading, { size: 11, font: fontBold, gapAfter: 2 });
      const meta = [formatDateRange(entry.startDate, entry.endDate), entry.location]
        .filter(Boolean)
        .join("  |  ");
      if (meta) drawTextLine(meta, { size: 9, color: mutedColor, gapAfter: 2 });
      for (const bullet of entry.bullets || []) {
        drawTextLine(`• ${bullet.text}`, { size: 10, indent: 10, gapAfter: 2 });
      }
      y -= 4;
    }
  }

  if ((payload.achievements || []).length > 0) {
    drawSectionTitle("Achievements");
    for (const entry of payload.achievements) {
      const line = [entry.title, entry.detail].filter(Boolean).join(" — ");
      if (line) drawTextLine(line, { size: 10, gapAfter: 4 });
    }
  }

  return Buffer.from(await pdfDoc.save());
}
