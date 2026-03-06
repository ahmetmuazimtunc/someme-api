-- Enable pg_trgm extension for fuzzy / partial-match indexing
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on users.username for fast case-insensitive partial search
CREATE INDEX IF NOT EXISTS user_username_trgm_idx
  ON users USING gin (username gin_trgm_ops);

-- Trigram index on users.display_name
CREATE INDEX IF NOT EXISTS user_display_name_trgm_idx
  ON users USING gin (display_name gin_trgm_ops);

-- Trigram index on captions.text for fast full-text caption search
CREATE INDEX IF NOT EXISTS caption_text_trgm_idx
  ON captions USING gin (text gin_trgm_ops);

-- Trigram index on tags.name for fast partial tag search
CREATE INDEX IF NOT EXISTS tag_name_trgm_idx
  ON tags USING gin (name gin_trgm_ops);
