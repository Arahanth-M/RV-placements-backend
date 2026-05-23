import { loadResumeContactIconBuffers } from "./resumeContactIcons.js";

const docIconCache = new WeakMap();

export async function loadResumeIcons(pdfDoc) {
  if (docIconCache.has(pdfDoc)) return docIconCache.get(pdfDoc);

  const buffers = await loadResumeContactIconBuffers();
  const icons = {};
  await Promise.all(
    Object.entries(buffers).map(async ([name, bytes]) => {
      if (!bytes) {
        icons[name] = null;
        return;
      }
      try {
        icons[name] = await pdfDoc.embedPng(bytes);
      } catch {
        icons[name] = null;
      }
    })
  );

  docIconCache.set(pdfDoc, icons);
  return icons;
}
