const axios = require('axios');
require('dotenv').config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const OPENAI_API_BASE = process.env.AI_API_BASE || 'https://api.openai.com/v1';

// Basic PII redaction: emails, Kenyan phone numbers, international phones
function redactPII(text){
  if (!text) return text;
  // mask emails
  let out = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  // mask common phone formats: 07XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX, 07X XXX XXXX
  out = out.replace(/(\+?254\s?7\d{2}\s?\d{3}\s?\d{3})/g, '[REDACTED_PHONE]');
  out = out.replace(/(\+?2547\d{8})/g, '[REDACTED_PHONE]');
  out = out.replace(/(07\d{8})/g, '[REDACTED_PHONE]');
  // mask sequences of 9-12 digits (possible IDs) conservatively
  out = out.replace(/\b\d{9,12}\b/g, '[REDACTED_NUMBER]');
  return out;
}

async function callOpenAI({ systemPrompt, userPrompt, maxTokens = 800 }){
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not configured');

  // Redact PII from prompts before sending
  const system = redactPII(systemPrompt || '');
  const user = redactPII(userPrompt || '');

  // Cap prompt size to avoid massive token usage
  const maxPromptChars = Number(process.env.AI_MAX_PROMPT_CHARS) || 8000;
  const combined = (system + '\n' + user).slice(0, maxPromptChars);

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
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

// Rough token estimate helper (4 chars per token heuristic)
function estimateTokensForText(text){
  if (!text) return 0;
  const chars = text.length;
  return Math.max(1, Math.ceil(chars / 4));
}

module.exports = { callOpenAI, redactPII, estimateTokensForText };
