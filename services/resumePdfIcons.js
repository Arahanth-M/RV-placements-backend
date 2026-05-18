/** Small black PNG icons for PDF contact row (24px, cached per process). */
const ICON_URLS = {
  phone: "https://img.icons8.com/ios-glyphs/30/phone.png",
  email: "https://img.icons8.com/ios-glyphs/30/new-post.png",
  linkedin: "https://img.icons8.com/ios-glyphs/30/linkedin.png",
  github: "https://img.icons8.com/ios-glyphs/30/github.png",
};

const docIconCache = new WeakMap();

export async function loadResumeIcons(pdfDoc) {
  if (docIconCache.has(pdfDoc)) return docIconCache.get(pdfDoc);

  const icons = {};
  await Promise.all(
    Object.entries(ICON_URLS).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          icons[name] = null;
          return;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        icons[name] = await pdfDoc.embedPng(bytes);
      } catch {
        icons[name] = null;
      }
    })
  );

  docIconCache.set(pdfDoc, icons);
  return icons;
}
