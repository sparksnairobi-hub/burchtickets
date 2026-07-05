const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { callOpenAI } = require('../services/aiService');

// POST /api/ai/revenue
// Body: { task: 'pricing'|'copy'|'email', eventId?, prompt? }
router.post('/revenue', requireAuth, async (req, res, next) => {
  try{
    const companyId = req.auth && req.auth.companyId;
    const { task, eventId, prompt } = req.body || {};
    if (!task) return res.status(400).json({ ok:false, error: 'MISSING_FIELDS' });

    // Build context from event if given
    let context = `Company id: ${companyId}.`;
    if (eventId){
      const ev = await pool.query('SELECT id, title, venue_name, venue_city, start_at, end_at FROM events WHERE id=$1', [eventId]);
      if (ev.rowCount){
        const e = ev.rows[0];
        context += ` Event: ${e.title} at ${e.venue_name}, ${e.venue_city} on ${e.start_at || 'TBA'}.`;
        const tiers = await pool.query('SELECT name, price, quantity_total, quantity_sold FROM ticket_tiers WHERE event_id=$1', [eventId]);
        if (tiers.rowCount){
          context += ' Ticket tiers:' + tiers.rows.map(t => ` ${t.name} KES ${t.price} (${t.quantity_sold}/${t.quantity_total} sold);`).join('');
        }
      }
    }

    // Compose prompts based on task
    const systemPrompt = 'You are a helpful revenue assistant for event organizers. Provide short actionable recommendations.';
    const userPrompt = `${context}\n\nTask: ${task}.\nUser prompt: ${prompt || ''}\n\nProvide 3 suggestions with title and 1-2 sentence rationale and 1 actionable step each.`;

    // Call OpenAI
    const ai = await callOpenAI({ systemPrompt, userPrompt, maxTokens:800 });

    // Persist usage
    try{
      await pool.query(
        `INSERT INTO ai_usage (company_id, event_id, task, prompt_snippet, response_snippet, tokens_used, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, NOW())`,
        [companyId || null, eventId || null, task, (prompt||'').slice(0,500), ai.text.slice(0,2000), (ai.usage && ai.usage.total_tokens) || null]
      );
    }catch(err){ console.warn('ai_usage insert failed', err.message || err); }

    return res.json({ ok:true, suggestions: ai.text, usage: ai.usage });
  }catch(err){ next(err); }
});

module.exports = router;
