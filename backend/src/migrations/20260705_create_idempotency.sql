-- idempotency table for requests that must be repeat-safe (checkout)

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  request_hash TEXT,
  order_id INTEGER,
  response_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys(key);
