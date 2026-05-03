/**
 * Escape a string for safe use inside a RegExp literal (substring match).
 * @param {string} s
 */
export default function escapeRegexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
