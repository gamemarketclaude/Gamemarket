CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одна подписка на пользователя. client_uuid — id клиента в Xray,
-- sub_token — секрет в URL подписки. expires_at <= now() значит «неактивна».
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_uuid UUID NOT NULL UNIQUE,
  sub_token   TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_expires_idx ON subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS plans (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  days          INT NOT NULL CHECK (days > 0 AND days <= 3660),
  price_kopecks INT NOT NULL CHECK (price_kopecks > 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VPN-серверы. Приватный ключ Reality здесь НЕ хранится — он только на самом сервере.
CREATE TABLE IF NOT EXISTS nodes (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  host         TEXT NOT NULL,
  port         INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
  sni          TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  short_id     TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             INT NOT NULL REFERENCES plans(id),
  amount_kopecks      INT NOT NULL CHECK (amount_kopecks > 0),
  days                INT NOT NULL CHECK (days > 0),
  provider_payment_id TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'succeeded', 'canceled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id, created_at DESC);
