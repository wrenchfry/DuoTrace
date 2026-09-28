CREATE TABLE IF NOT EXISTS analytics_searches (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id TEXT NOT NULL UNIQUE,
  first_game_name TEXT NOT NULL,
  first_tag_line TEXT NOT NULL,
  second_game_name TEXT NOT NULL,
  second_tag_line TEXT NOT NULL,
  region TEXT NOT NULL,
  searched_at TEXT NOT NULL,
  shared_match_count INTEGER NOT NULL,
  matches_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_searches_sequence
  ON analytics_searches(sequence);
