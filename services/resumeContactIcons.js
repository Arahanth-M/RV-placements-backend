/** Small black PNG icons for resume contact rows (shared by PDF and Word export). */
export const RESUME_CONTACT_ICON_URLS = {
  phone: "https://img.icons8.com/ios-glyphs/30/phone.png",
  email: "https://img.icons8.com/ios-glyphs/30/new-post.png",
  linkedin: "https://img.icons8.com/ios-glyphs/30/linkedin.png",
  github: "https://img.icons8.com/ios-glyphs/30/github.png",
};

let bufferCache = null;

export async function loadResumeContactIconBuffers() {
  if (bufferCache) return bufferCache;

  const icons = {};
  await Promise.all(
    Object.entries(RESUME_CONTACT_ICON_URLS).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          icons[name] = null;
          return;
        }
        icons[name] = Buffer.from(await response.arrayBuffer());
      } catch {
        icons[name] = null;
      }
    })
  );

  bufferCache = icons;
  return icons;
}

/** @internal test helper */
export function clearResumeContactIconCache() {
  bufferCache = null;
}
