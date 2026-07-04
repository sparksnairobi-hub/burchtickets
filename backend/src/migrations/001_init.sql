-- BurchTickets — core schema
-- Run with: psql $DATABASE_URL -f src/migrations/001_init.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ ENUMS ============
DO $$ BEGIN CREATE TYPE company_status AS ENUM ('pending','verified','suspended'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE event_status AS ENUM ('draft','published','paused','ended','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('pending','paid','failed','expired','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('initiated','pending','successful','failed','reversed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE ticket_status AS ENUM ('issued','checked_in','void'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE booking_status AS ENUM ('initiated','held','payment_pending','confirmed','failed','expired'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE webhook_status AS ENUM ('received','verified','processed','duplicate','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE email_status AS ENUM ('pending','sending','sent','failed','duplicate'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ CORE TABLES ============
CREATE TABLE IF NOT EXISTS companies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  phone VARCHAR(30),
  business_type VARCHAR(80),
  mpesa_paybill VARCHAR(50),
  mpesa_till VARCHAR(50),
  status company_status NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'owner',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- Buyer accounts are separate from organizer users: buyers never get a
-- company_id, and checkout stays guest-friendly (buyer_id on orders is
-- nullable). An account just makes past orders/tickets easy to find again.
CREATE TABLE IF NOT EXISTS buyers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  slug VARCHAR(320) NOT NULL UNIQUE,
  description TEXT,
  venue_name VARCHAR(200) NOT NULL,
  venue_city VARCHAR(100) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status event_status NOT NULL DEFAULT 'draft',
  banner_url TEXT,
  capacity INTEGER,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_event_dates CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_events_company_id ON events(company_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  quantity_total INTEGER NOT NULL CHECK (quantity_total >= 0),
  quantity_sold INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  max_per_order INTEGER NOT NULL DEFAULT 10 CHECK (max_per_order > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ticket_tier_sold CHECK (quantity_sold <= quantity_total)
);
CREATE INDEX IF NOT EXISTS idx_ticket_tiers_event_id ON ticket_tiers(event_id);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  buyer_id BIGINT REFERENCES buyers(id) ON DELETE SET NULL,
  buyer_name VARCHAR(200) NOT NULL,
  buyer_email CITEXT NOT NULL,
  buyer_phone VARCHAR(30),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  status order_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_company_id ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_ref VARCHAR(200),
  checkout_request_id VARCHAR(200),
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  status payment_status NOT NULL DEFAULT 'initiated',
  raw_payload JSONB,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_provider_ref UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_checkout_request_id ON payments(checkout_request_id);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  ticket_code VARCHAR(80) NOT NULL UNIQUE,
  qr_secret VARCHAR(120) NOT NULL UNIQUE,
  holder_name VARCHAR(200) NOT NULL,
  holder_email CITEXT NOT NULL,
  status ticket_status NOT NULL DEFAULT 'issued',
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_order_item_id ON tickets(order_item_id);

CREATE TABLE IF NOT EXISTS commissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  rate_percent NUMERIC(5,2) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_holds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  hold_key VARCHAR(200) NOT NULL UNIQUE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  session_key VARCHAR(200) NOT NULL UNIQUE,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  payment_expires_at TIMESTAMPTZ,
  status booking_status NOT NULL DEFAULT 'initiated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(100),
  signature VARCHAR(500),
  timestamp_received TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  raw_body TEXT,
  status webhook_status NOT NULL DEFAULT 'received',
  processed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_events_provider_event UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS email_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  recipient_email CITEXT NOT NULL,
  recipient_name VARCHAR(200),
  template_key VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(250) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'smtp',
  provider_message_id VARCHAR(200),
  status email_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_email_jobs_idempotency UNIQUE (idempotency_key)
);

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_ticket_tiers_updated_at BEFORE UPDATE ON ticket_tiers FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_booking_sessions_updated_at BEFORE UPDATE ON booking_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_webhook_events_updated_at BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TRIGGER trg_email_jobs_updated_at BEFORE UPDATE ON email_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ confirm_booking() ============
CREATE OR REPLACE FUNCTION confirm_booking(p_order_id BIGINT, p_payment_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_item RECORD;
  v_i INT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment % not found', p_payment_id; END IF;

  IF v_order.status = 'paid' THEN RETURN; END IF;
  IF v_payment.status <> 'successful' THEN RAISE EXCEPTION 'Payment % not successful', p_payment_id; END IF;

  UPDATE ticket_tiers tt
  SET quantity_sold = quantity_sold + oi.quantity, updated_at = NOW()
  FROM order_items oi
  WHERE oi.order_id = p_order_id AND oi.ticket_tier_id = tt.id
    AND tt.quantity_sold + oi.quantity <= tt.quantity_total;

  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient inventory for order %', p_order_id; END IF;

  UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = p_order_id;
  UPDATE booking_sessions SET status = 'confirmed', updated_at = NOW() WHERE order_id = p_order_id;

  -- Issue one ticket row (with its own scannable code) per unit purchased
  FOR v_item IN SELECT id, quantity FROM order_items WHERE order_id = p_order_id LOOP
    FOR v_i IN 1..v_item.quantity LOOP
      INSERT INTO tickets (order_item_id, ticket_code, qr_secret, holder_name, holder_email, status, created_at)
      VALUES (
        v_item.id,
        'BT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FOR 10)),
        REPLACE(gen_random_uuid()::text, '-', '') || REPLACE(gen_random_uuid()::text, '-', ''),
        v_order.buyer_name,
        v_order.buyer_email,
        'issued',
        NOW()
      );
    END LOOP;
  END LOOP;

  INSERT INTO commissions (order_id, rate_percent, amount, status, created_at, updated_at)
  VALUES (p_order_id, COALESCE(v_order.commission_rate, 10),
          ROUND((v_order.total_amount * COALESCE(v_order.commission_rate, 10)) / 100.0, 2),
          'pending', NOW(), NOW())
  ON CONFLICT (order_id) DO NOTHING;

  INSERT INTO booking_events (order_id, event_type, event_data)
  VALUES (p_order_id, 'booking_confirmed', jsonb_build_object('payment_id', p_payment_id, 'confirmed_at', NOW()));
END;
$$ LANGUAGE plpgsql;

COMMIT;
