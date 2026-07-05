const Redis = require('ioredis');
require('dotenv').config();

let redis;
if (process.env.REDIS_URL){
  redis = new Redis(process.env.REDIS_URL);
}

// fallback in-memory
const memory = new Map();

const WINDOW = Number(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60; // seconds
const MAX = Number(process.env.RATE_LIMIT_MAX) || 30; // requests per window

async function rateLimiter(req, res, next){
  try{
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const redisKey = `rl:${key}`;
    if (redis){
      const v = await redis.incr(redisKey);
      if (v === 1) await redis.expire(redisKey, WINDOW);
      if (v > MAX) return res.status(429).json({ ok:false, error: 'RATE_LIMIT_EXCEEDED' });
      return next();
    } else {
      const now = Math.floor(Date.now() / 1000);
      const record = memory.get(key) || { ts: now, count: 0 };
      if (now - record.ts >= WINDOW){ record.ts = now; record.count = 1; }
      else { record.count++; }
      memory.set(key, record);
      if (record.count > MAX) return res.status(429).json({ ok:false, error: 'RATE_LIMIT_EXCEEDED' });
      return next();
    }
  }catch(err){ console.warn('rateLimiter error', err.message || err); return next(); }
}

module.exports = rateLimiter;
