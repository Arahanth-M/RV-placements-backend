import redis from "./redisClient.js";

export async function getJSON(key) {
  try {
    const rawValue = await redis.get(key);

    if (rawValue == null) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      console.error(`[Redis] Invalid JSON for key "${key}":`, error.message);
      return null;
    }
  } catch (error) {
    console.error(`[Redis] Failed to get key "${key}":`, error.message);
    return null;
  }
}

export async function setJSON(key, value, ttlSeconds) {
  try {
    const payload = JSON.stringify(value);

    if (Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      await redis.set(key, payload, "EX", ttlSeconds);
      return true;
    }

    await redis.set(key, payload);
    return true;
  } catch (error) {
    console.error(`[Redis] Failed to set key "${key}":`, error.message);
    return false;
  }
}

export async function addToSet(key, value, ttlSeconds) {
  try {
    if (Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      await redis.multi().sadd(key, value).expire(key, ttlSeconds).exec();
      return true;
    }

    await redis.sadd(key, value);
    return true;
  } catch (error) {
    console.error(`[Redis] Failed to add to set "${key}":`, error.message);
    return false;
  }
}

export async function getSetMembers(key) {
  try {
    return await redis.smembers(key);
  } catch (error) {
    console.error(`[Redis] Failed to get set members for "${key}":`, error.message);
    return [];
  }
}
