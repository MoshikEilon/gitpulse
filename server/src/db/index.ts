import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/gitpulse.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS repositories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    is_org BOOLEAN DEFAULT 0,
    org_name TEXT,
    description TEXT,
    language TEXT,
    stars INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    is_private BOOLEAN DEFAULT 0,
    html_url TEXT,
    default_branch TEXT DEFAULT 'main',
    created_at DATETIME,
    updated_at DATETIME,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS commits (
    sha TEXT PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    message TEXT,
    author_name TEXT,
    author_email TEXT,
    committed_at DATETIME,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    files_changed INTEGER DEFAULT 0,
    url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_full_name) REFERENCES repositories(full_name)
  );

  CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    state TEXT,
    merged BOOLEAN DEFAULT 0,
    draft BOOLEAN DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME,
    merged_at DATETIME,
    closed_at DATETIME,
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    changed_files INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    review_comments INTEGER DEFAULT 0,
    commits INTEGER DEFAULT 0,
    labels TEXT DEFAULT '[]',
    base_branch TEXT,
    html_url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_full_name) REFERENCES repositories(full_name),
    UNIQUE(repo_full_name, number)
  );

  CREATE TABLE IF NOT EXISTS pr_reviews (
    id INTEGER PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    state TEXT,
    body TEXT,
    submitted_at DATETIME,
    html_url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_full_name) REFERENCES repositories(full_name)
  );

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    state TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    closed_at DATETIME,
    labels TEXT DEFAULT '[]',
    comments INTEGER DEFAULT 0,
    html_url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_full_name) REFERENCES repositories(full_name),
    UNIQUE(repo_full_name, number)
  );

  CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_full_name);
  CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(committed_at);
  CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo_full_name);
  CREATE INDEX IF NOT EXISTS idx_prs_date ON pull_requests(created_at);
  CREATE INDEX IF NOT EXISTS idx_prs_state ON pull_requests(state);
  CREATE INDEX IF NOT EXISTS idx_reviews_repo ON pr_reviews(repo_full_name);
  CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo_full_name);
`);

export function getSyncState(key: string): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncState(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
}

console.log(`Database initialized at ${DB_PATH}`);
