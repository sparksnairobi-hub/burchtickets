-- create ai_usage table to log LLM prompts and token consumption

CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  task TEXT,
  prompt_snippet TEXT,
  response_snippet TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_company ON ai_usage(company_id);
