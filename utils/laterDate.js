/** Latest of several date-like values. */
export function toValidDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function laterDate(...values) {
  let best = null;
  for (const value of values) {
    const d = toValidDate(value);
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

export function laterDateIso(...values) {
  const d = laterDate(...values);
  return d ? d.toISOString() : null;
}
