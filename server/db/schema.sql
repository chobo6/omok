-- 랭킹전 레이팅 + 기보 저장 스키마. 설계 배경은 docs/DB_SCHEMA.md 참고.
-- 별도 마이그레이션 프레임워크 없이 이 파일을 통째로 재실행하는 방식(멱등) — 테이블 2개뿐인 현재 규모에 맞춘 최소 구성.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  nickname TEXT NOT NULL DEFAULT '플레이어',
  rating INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  black_user_id UUID NOT NULL REFERENCES users(id),
  white_user_id UUID NOT NULL REFERENCES users(id),
  winner SMALLINT NOT NULL CHECK (winner IN (0, 1, 2)),
  reason TEXT NOT NULL CHECK (reason IN ('win', 'draw', 'timeout', 'surrender', 'disconnect', 'forbidden')),
  forbidden_type TEXT,
  black_rating_before INTEGER NOT NULL,
  white_rating_before INTEGER NOT NULL,
  black_rating_delta INTEGER NOT NULL,
  white_rating_delta INTEGER NOT NULL,
  moves JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (black_user_id <> white_user_id)
);

CREATE INDEX IF NOT EXISTS games_black_user_id_idx ON games(black_user_id);
CREATE INDEX IF NOT EXISTS games_white_user_id_idx ON games(white_user_id);
CREATE INDEX IF NOT EXISTS games_ended_at_idx ON games(ended_at DESC);
