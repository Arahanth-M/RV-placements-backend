/** Pure helpers for DAU engaged-time. No Redis/Mongo. */

export const MIN_HEARTBEAT_INTERVAL_MS = 20_000;
export const MAX_HEARTBEAT_DELTA_MS = 60_000;
export const HEARTBEAT_FLUSH_THRESHOLD_MS = 180_000;
export const REDIS_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export function pendingActiveKey(dayKey, userId) {
  return `dau:hb:pending:${dayKey}:${userId}`;
}

export function heartbeatLastKey(userId) {
  return `dau:hb:last:${userId}`;
}

export function heartbeatDayKey(userId) {
  return `dau:hb:day:${userId}`;
}

export function clampHeartbeatDeltaMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_HEARTBEAT_DELTA_MS, Math.floor(n));
}

/**
 * Credit at most wall-clock time since last accepted ping, capped at MAX_HEARTBEAT_DELTA_MS.
 * Too-frequent pings credit 0.
 */
export function creditHeartbeatMs({ deltaMs, lastAcceptedAt, now } = {}) {
  const delta = clampHeartbeatDeltaMs(deltaMs);
  if (!delta) return 0;
  const nowMs = Number(now);
  const last = Number(lastAcceptedAt);
  if (!Number.isFinite(nowMs)) return 0;
  if (Number.isFinite(last) && last > 0) {
    const elapsed = nowMs - last;
    if (elapsed < MIN_HEARTBEAT_INTERVAL_MS) return 0;
    return Math.min(delta, elapsed, MAX_HEARTBEAT_DELTA_MS);
  }
  return delta;
}

export function formatActiveMsLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 1000) return "—";
  const totalSec = Math.floor(n / 1000);
  if (totalSec < 60) return "<1m";
  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function combineActiveMs(storedMs, pendingMs) {
  const stored = Number(storedMs);
  const pending = Number(pendingMs);
  const a = Number.isFinite(stored) && stored > 0 ? stored : 0;
  const b = Number.isFinite(pending) && pending > 0 ? pending : 0;
  const total = a + b;
  return total > 0 ? total : null;
}

/**
 * Mongo update used when flushing Redis → dau_day_users.
 * Identity fields only on $setOnInsert. $inc creates activeMs if missing.
 */
export function activeMsFlushUpdate({ userId, email, username, role, dayKey, now, ms }) {
  return {
    $setOnInsert: {
      dayKey,
      userId,
      email: String(email || "")
        .trim()
        .toLowerCase(),
      username: String(username || "").trim(),
      role: String(role || "").trim(),
      firstSeenAt: now,
    },
    $set: { lastSeenAt: now },
    $inc: { activeMs: ms },
  };
}
