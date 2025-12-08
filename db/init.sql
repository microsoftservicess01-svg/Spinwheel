PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  result TEXT NOT NULL,
  spun_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS gift_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  claim_date TEXT NOT NULL,
  spun_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS daily_winner (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  winner_client_id TEXT,
  winner_date TEXT NOT NULL UNIQUE,
  chosen_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q_key TEXT UNIQUE,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK(correct_index BETWEEN 0 AND 3)
);

CREATE TABLE IF NOT EXISTS quiz_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  selected_index INTEGER NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  claim_date TEXT NOT NULL,
  answered_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS daily_quiz_winner (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  winner_client_id TEXT,
  winner_quiz_id TEXT,
  winner_date TEXT NOT NULL UNIQUE,
  chosen_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
