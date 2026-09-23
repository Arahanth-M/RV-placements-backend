export const MIN_STUDY_SLOT_MINUTES = 30;
export const MAX_STUDY_SLOTS_PER_DAY = 6;

export function dayMinutesFromHours(hoursPerDay) {
  const hours = Number(hoursPerDay);
  if (!Number.isFinite(hours) || hours < 0.5) return MIN_STUDY_SLOT_MINUTES;
  return Math.max(MIN_STUDY_SLOT_MINUTES, Math.round(hours * 60));
}

export function formatStudyDuration(minutes) {
  const mins = Math.max(1, Math.round(Number(minutes) || 0));
  if (mins % 60 === 0) {
    const hours = mins / 60;
    return hours === 1 ? "1h" : `${hours}h`;
  }
  if (mins > 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }
  return `${mins} min`;
}

export function studyScheduleLabel({ style, slotsPerDay, slotMinutes }) {
  if (style === "stretch" || Number(slotsPerDay) === 1) {
    return `One stretch · ${formatStudyDuration(slotMinutes)}`;
  }
  return `${slotsPerDay} slots · ${formatStudyDuration(slotMinutes)} each`;
}

/**
 * Even splits of the day's hours. Stretch is always first.
 */
export function listStudyScheduleOptions(hoursPerDay) {
  const dayMinutes = dayMinutesFromHours(hoursPerDay);
  const options = [
    {
      id: `stretch-${dayMinutes}`,
      style: "stretch",
      slotsPerDay: 1,
      slotMinutes: dayMinutes,
      label: studyScheduleLabel({
        style: "stretch",
        slotsPerDay: 1,
        slotMinutes: dayMinutes,
      }),
      detail: "Study the day's hours in a single sitting.",
    },
  ];
  for (let slots = 2; slots <= MAX_STUDY_SLOTS_PER_DAY; slots += 1) {
    if (dayMinutes % slots !== 0) continue;
    const slotMinutes = dayMinutes / slots;
    if (slotMinutes < MIN_STUDY_SLOT_MINUTES) break;
    options.push({
      id: `batches-${slots}x${slotMinutes}`,
      style: "batches",
      slotsPerDay: slots,
      slotMinutes,
      label: studyScheduleLabel({
        style: "batches",
        slotsPerDay: slots,
        slotMinutes,
      }),
      detail: `Split each day into ${slots} focused blocks.`,
    });
  }
  return options;
}

export function normalizeStudyScheduleChoice({
  hoursPerDay,
  style,
  slotMinutes,
  slotsPerDay,
} = {}) {
  const dayMinutes = dayMinutesFromHours(hoursPerDay);
  const slots = Math.round(Number(slotsPerDay));
  const slot = Math.round(Number(slotMinutes));
  const styleNorm = String(style || "").trim() === "batches" ? "batches" : "stretch";

  const invalid = () => {
    const err = new Error("Pick a study style that matches your hours per day.");
    err.code = "INVALID_SCHEDULE";
    throw err;
  };

  if (!Number.isFinite(slots) || !Number.isFinite(slot) || slots < 1 || slot < 1) {
    invalid();
  }

  if (styleNorm === "stretch") {
    if (slots !== 1 || slot !== dayMinutes) invalid();
  } else {
    if (slots < 2 || slots > MAX_STUDY_SLOTS_PER_DAY) invalid();
    if (slot < MIN_STUDY_SLOT_MINUTES) invalid();
    if (slots * slot !== dayMinutes) invalid();
  }

  return {
    style: styleNorm,
    slotsPerDay: slots,
    slotMinutes: slot,
    label: studyScheduleLabel({
      style: styleNorm,
      slotsPerDay: slots,
      slotMinutes: slot,
    }),
  };
}

export function packTasksIntoSlots(tasks, capacities) {
  const slots = (Array.isArray(capacities) ? capacities : []).map((minutes, i) => ({
    index: i + 1,
    minutes: Math.max(0, Math.round(Number(minutes) || 0)),
    tasks: [],
  }));
  if (!slots.length) return slots;

  const remaining = slots.map((slot) => slot.minutes);
  let si = 0;

  const cloneTask = (raw, { title, minutes, firstPiece }) => ({
    title,
    minutes,
    resourceHint: firstPiece ? String(raw?.resourceHint || "") : "",
    notes: firstPiece ? String(raw?.notes || "") : "",
  });

  for (const raw of Array.isArray(tasks) ? tasks : []) {
    const title = String(raw?.title || "Task").trim() || "Task";
    let left = Math.max(0, Math.round(Number(raw?.minutes) || 0));
    let firstPiece = true;

    if (left <= 0) {
      while (si < slots.length - 1 && remaining[si] <= 0) si += 1;
      slots[si].tasks.push(cloneTask(raw, { title, minutes: 0, firstPiece: true }));
      continue;
    }

    while (left > 0) {
      while (si < slots.length - 1 && remaining[si] <= 0) si += 1;
      const room = remaining[si];
      const take = room > 0 ? Math.min(left, room) : left;
      slots[si].tasks.push(
        cloneTask(raw, {
          title: firstPiece ? title : `${title} (cont.)`,
          minutes: take,
          firstPiece,
        })
      );
      firstPiece = false;
      left -= take;
      if (room > 0) remaining[si] -= take;
      else break;
    }
  }

  return slots;
}

export function applyStudyScheduleToDays(days, choice, hoursPerDay) {
  const dayMinutes = dayMinutesFromHours(hoursPerDay);
  const capacities = Array.from({ length: choice.slotsPerDay }, () => choice.slotMinutes);
  const sum = capacities.reduce((a, b) => a + b, 0);
  if (capacities.length && sum !== dayMinutes) {
    capacities[capacities.length - 1] += dayMinutes - sum;
  }
  return (Array.isArray(days) ? days : []).map((day) => ({
    ...day,
    slots: packTasksIntoSlots(day?.tasks, capacities),
  }));
}
