import redis, { redisUrl } from "./redisClient.js";

export async function getJSON(key) {
  let rawValue;
  try {
    rawValue = await redis.get(key);
  } catch (error) {
    console.error(`[Redis] get failed for key "${key}":`, error);
    return null;
  }

  if (rawValue == null) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.error(`[Redis] Invalid JSON for key "${key}":`, error.message);
    return null;
  }
}

export async function setJSON(key, value, ttlSeconds) {
  let payload;
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    console.error(`[Redis] Failed to serialize value for key "${key}":`, error);
    return false;
  }

  try {
    if (Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      await redis.set(key, payload, { EX: ttlSeconds });
    } else {
      await redis.set(key, payload);
    }
    return true;
  } catch (error) {
    console.error(`[Redis] set failed for key "${key}":`, error);
    return false;
  }
}

export async function addToSet(key, value, ttlSeconds) {
  try {
    if (Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      await redis.multi().sAdd(key, value).expire(key, ttlSeconds).exec();
    } else {
      await redis.sAdd(key, value);
    }
    return true;
  } catch (error) {
    console.error(`[Redis] addToSet failed for key "${key}":`, error);
    return false;
  }
}

export async function getSetMembers(key) {
  try {
    return await redis.sMembers(key);
  } catch (error) {
    console.error(`[Redis] sMembers failed for key "${key}":`, error);
    return [];
  }
}

export async function deleteKey(key) {
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error(`[Redis] del failed for key "${key}":`, error);
    return false;
  }
}

/**
 * Delete all keys matching `prefix*` (SCAN, not KEYS). No-op if Redis is unset.
 * @param {string} prefix
 * @returns {Promise<number>} keys removed
 */
export async function deleteKeysByPrefix(prefix) {
  if (!redisUrl || !prefix) return 0;
  let deleted = 0;
  try {
    for await (const key of redis.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 100,
    })) {
      await redis.del(key);
      deleted += 1;
    }
  } catch (error) {
    console.error(`[Redis] deleteKeysByPrefix failed for "${prefix}":`, error);
  }
  return deleted;
}
