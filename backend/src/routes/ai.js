const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { callOpenAI, estimateTokensForText } = require('../services/aiService');

// POST /api/ai/revenue
// Body: { task: 'pricing'|'copy'|'email', eventId?, prompt? }
router.post('/revenue', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try{
    const companyId = req.auth && req.auth.companyId;
    const { task, eventId, prompt } = req.body || {};
    if (!task) return res.status(400).json({ ok:false, error: 'MISSING_FIELDS' });

    // Determine company quota (monthly tokens)
    const defaultQuota = Number(process.env.DEFAULT_AI_MONTHLY_TOKENS) || 100000; // tokens
    let companyQuota = defaultQuota;
    try{
      const c = await client.query('SELECT ai_monthly_token_limit FROM companies WHERE id=$1', [companyId]);
      if (c.rowCount && c.rows[0].ai_monthly_token_limit) companyQuota = Number(c.rows[0].ai_monthly_token_limit);
    }catch(err){
      // if the column doesn't exist or query fails, fall back to default
      // console.warn('company quota lookup failed', err.message||err);
    }

    // Calculate tokens used in the last 30 days
    const usedRes = await client.query("SELECT COALESCE(SUM(tokens_used),0) AS used FROM ai_usage WHERE company_id=$1 AND created_at > now() - INTERVAL '30 days'", [companyId]);
    const usedTokens = Number((usedRes.rows && usedRes.rows[0] && usedRes.rows[0].used) || 0);

    // conservative estimate of tokens this request would consume (based on prompt length)
    const systemPrompt = 'You are a helpful revenue assistant for event organizers. Provide short actionable recommendations.';
    // We will include event context below; estimate tokens from combined text
    let contextText = `Company id: ${companyId}.`;
    if (eventId){
      try{
        const ev = await client.query('SELECT id, title, venue_name, venue_city, start_at FROM events WHERE id=$1', [eventId]);
        if (ev.rowCount){
          const e = ev.rows[0];
          contextText += ` Event: ${e.title} at ${e.venue_name}, ${e.venue_city} on ${e.start_at || 'TBA'}.`;
          const tiers = await client.query('SELECT name, price, quantity_total, quantity_sold FROM ticket_tiers WHERE event_id=$1', [eventId]);
          if (tiers.rowCount){
            contextText += ' Ticket tiers:' + tiers.rows.map(t => ` ${t.name} KES ${t.price} (${t.quantity_sold}/${t.quantity_total} sold);`).join('');
          }
        }
      }catch(e){ /* ignore event read errors for quota calc */ }
    }

    const userPrompt = `${contextText}\n\nTask: ${task}.\nUser prompt: ${prompt || ''}`;
    const estimatedTokens = estimateTokensForText(systemPrompt + '\n' + userPrompt);

    if (usedTokens + estimatedTokens > companyQuota){
      return res.status(402).json({ ok:false, error:'AI_QUOTA_EXCEEDED', message:'Company AI monthly quota exceeded. Contact support to increase quota.' });
    }

    // Call OpenAI
    const ai = await callOpenAI({ systemPrompt, userPrompt, maxTokens:800 });

    // Persist usage
    try{
      await client.query(
        `INSERT INTO ai_usage (company_id, event_id, task, prompt_snippet, response_snippet, tokens_used, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, NOW())`,
        [companyId || null, eventId || null, task, (prompt||'').slice(0,500), ai.text.slice(0,2000), (ai.usage && ai.usage.total_tokens) || null]
      );
    }catch(err){ console.warn('ai_usage insert failed', err.message || err); }

    return res.json({ ok:true, suggestions: ai.text, usage: ai.usage });
  }catch(err){ next(err); } finally { client.release(); }
});

module.exports = router;
