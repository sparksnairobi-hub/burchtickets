const pool = require('../config/db');
const Redis = require('ioredis');
require('dotenv').config();

let redis;
if (process.env.REDIS_URL){
  redis = new Redis(process.env.REDIS_URL);
}

// fallback in-memory store per company
const memory = new Map();

const WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW_SECONDS) || 60; // seconds
const MAX_PER_COMPANY = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 2; // requests per window per company

async function orgRateLimiter(req, res, next){
  try{
    const companyId = req.auth && req.auth.companyId;
    if (!companyId) return res.status(401).json({ ok:false, error:'MISSING_COMPANY_AUTH' });

    const key = `org_rl:${companyId}`;
    if (redis){
      const v = await redis.incr(key);
      if (v === 1) await redis.expire(key, WINDOW);
      if (v > MAX_PER_COMPANY) return res.status(429).json({ ok:false, error: 'ORG_RATE_LIMIT_EXCEEDED' });
      return next();
    } else {
      const now = Math.floor(Date.now() / 1000);
      const rec = memory.get(key) || { ts: now, count: 0 };
      if (now - rec.ts >= WINDOW){ rec.ts = now; rec.count = 1; }
      else { rec.count++; }
      memory.set(key, rec);
      if (rec.count > MAX_PER_COMPANY) return res.status(429).json({ ok:false, error: 'ORG_RATE_LIMIT_EXCEEDED' });
      return next();
    }
  }catch(err){ console.warn('orgRateLimiter error', err.message||err); return next(); }
}

module.exports = orgRateLimiter;
