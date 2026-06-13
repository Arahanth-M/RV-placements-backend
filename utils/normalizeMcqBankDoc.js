const OPTION_IDS = ["A", "B", "C", "D", "E", "F"];

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/**
 * Normalize flat bank fields (options_A, …) or nested mcqMetadata into one shape.
 * @param {Record<string, unknown>|null|undefined} doc
 * @returns {Record<string, unknown>|null}
 */
export function normalizeMcqBankDoc(doc) {
  if (!doc || typeof doc !== "object") return null;

  const nested =
    doc.mcqMetadata && typeof doc.mcqMetadata === "object" ? doc.mcqMetadata : null;

  let options = [];
  if (Array.isArray(nested?.options) && nested.options.length > 0) {
    options = nested.options
      .map((opt, index) => {
        if (!opt || typeof opt !== "object") return null;
        const id = toSafeString(opt.id, OPTION_IDS[index] || "").toUpperCase();
        const text = toSafeString(opt.text);
        if (!id || !text) return null;
        return {
          id,
          text,
          distractorReason: toSafeString(opt.distractorReason),
        };
      })
      .filter(Boolean);
  } else {
    options = OPTION_IDS.map((id) => {
      const text = toSafeString(doc[`options_${id}`] ?? doc[`option${id}`]);
      if (!text) return null;
      return {
        id,
        text,
        distractorReason: toSafeString(doc[`distractorReason_${id}`]),
      };
    }).filter(Boolean);
  }

  if (options.length < 2) return null;

  const correctRaw = toSafeString(
    nested?.correctOptionId ?? doc.correctOptionId ?? doc.answer
  ).toUpperCase();
  const correctOptionId = OPTION_IDS.includes(correctRaw) ? correctRaw : "";
  if (!correctOptionId) return null;

  const allowMultiple =
    nested?.allowMultiple === true || doc.allowMultiple === true;

  return {
    options,
    correctOptionId,
    allowMultiple,
    shuffleOptions: nested?.shuffleOptions !== false && doc.shuffleOptions !== false,
    explanation: toSafeString(nested?.explanation ?? doc.explanation),
    explanationRequired:
      nested?.explanationRequired === true || doc.explanationRequired === true,
    selectionWeight:
      Number(nested?.selectionWeight ?? doc.selectionWeight) >= 0
        ? Number(nested?.selectionWeight ?? doc.selectionWeight)
        : 1,
    explanationWeight:
      Number(nested?.explanationWeight ?? doc.explanationWeight) >= 0
        ? Number(nested?.explanationWeight ?? doc.explanationWeight)
        : 0,
  };
}

/**
 * Strip grading secrets before sending options to the client.
 * @param {Record<string, unknown>|null|undefined} mcqMetadata
 */
export function buildClientMcqPayload(mcqMetadata) {
  if (!mcqMetadata || typeof mcqMetadata !== "object") return null;
  const options = Array.isArray(mcqMetadata.options) ? mcqMetadata.options : [];
  if (options.length < 2) return null;
  return {
    options: options.map((opt) => ({
      id: toSafeString(opt?.id).toUpperCase(),
      text: toSafeString(opt?.text),
    })),
    allowMultiple: mcqMetadata.allowMultiple === true,
    shuffleOptions: mcqMetadata.shuffleOptions !== false,
  };
}

/**
 * @param {unknown} rawAnswer
 * @returns {string}
 */
export function parseMcqSelectedOptionId(rawAnswer) {
  const safe = toSafeString(rawAnswer);
  if (!safe) return "";
  const upper = safe.toUpperCase();
  if (OPTION_IDS.includes(upper)) return upper;
  const letterMatch =
    upper.match(/\bOPTION\s*([A-F])\b/) || upper.match(/^([A-F])[\s.:)\]-]/);
  if (letterMatch && OPTION_IDS.includes(letterMatch[1])) return letterMatch[1];
  const first = upper.charAt(0);
  return OPTION_IDS.includes(first) ? first : "";
}

export default normalizeMcqBankDoc;
