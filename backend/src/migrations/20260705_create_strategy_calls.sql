-- Migration: create strategy_calls table

CREATE TABLE IF NOT EXISTS strategy_calls (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  preferred_date TIMESTAMP WITH TIME ZONE,
  message TEXT,
  source TEXT,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_calls_email ON strategy_calls(email);
