const axios = require('axios');
require('dotenv').config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const OPENAI_API_BASE = process.env.AI_API_BASE || 'https://api.openai.com/v1';

async function callOpenAI({ systemPrompt, userPrompt, maxTokens = 800 }){
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not configured');
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  const payload = {
    model: OPENAI_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  const res = await axios.post(`${OPENAI_API_BASE}/chat/completions`, payload, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` }
  });
  const data = res.data;
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const usage = data.usage || {};
  return { text, usage, raw: data };
}

module.exports = { callOpenAI };
