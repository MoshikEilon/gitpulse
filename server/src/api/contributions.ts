import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';

export const contributionsRouter = Router();

// GET /api/stats — overall summary
contributionsRouter.get('/stats', (_req: Request, res: Response) => {
  const repos = db.prepare('SELECT COUNT(*) as count FROM repositories').get() as { count: number };
  const orgRepos = db.prepare('SELECT COUNT(*) as count FROM repositories WHERE is_org=1').get() as { count: number };
  const commits = db.prepare('SELECT COUNT(*) as count, MIN(committed_at) as earliest, MAX(committed_at) as latest FROM commits').get() as { count: number; earliest: string; latest: string };
  const prs = db.prepare('SELECT COUNT(*) as count, SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged, SUM(CASE WHEN state="open" THEN 1 ELSE 0 END) as open FROM pull_requests').get() as { count: number; merged: number; open: number };
  const reviews = db.prepare('SELECT COUNT(*) as count FROM pr_reviews').get() as { count: number };
  const issues = db.prepare('SELECT COUNT(*) as count, SUM(CASE WHEN state="open" THEN 1 ELSE 0 END) as open FROM issues').get() as { count: number; open: number };

  res.json({ repos: { total: repos.count, orgs: orgRepos.count }, commits, prs, reviews, issues });
});

// GET /api/repos — list repos
contributionsRouter.get('/repos', (req: Request, res: Response) => {
  const { org, sort = 'updated_at', order = 'desc', limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM repositories';
  const params: (string | number)[] = [];
  if (org) {
    query += ' WHERE org_name = ?';
    params.push(org as string);
  }
  query += ` ORDER BY ${sort} ${order === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/commits — paginated commits
contributionsRouter.get('/commits', (req: Request, res: Response) => {
  const { repo, from, to, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM commits WHERE 1=1';
  const params: (string | number)[] = [];
  if (repo) { query += ' AND repo_full_name = ?'; params.push(repo as string); }
  if (from) { query += ' AND committed_at >= ?'; params.push(from as string); }
  if (to) { query += ' AND committed_at <= ?'; params.push(to as string); }
  query += ' ORDER BY committed_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/commits/heatmap — daily commit counts for calendar heatmap
contributionsRouter.get('/commits/heatmap', (req: Request, res: Response) => {
  const { months = 12 } = req.query;
  const rows = db.prepare(`
    SELECT date(committed_at) as date, COUNT(*) as count
    FROM commits
    WHERE committed_at > datetime('now', '-${Number(months)} months')
    GROUP BY date ORDER BY date
  `).all();
  res.json(rows);
});

// GET /api/commits/monthly — monthly aggregation
contributionsRouter.get('/commits/monthly', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', committed_at) as month,
           COUNT(*) as commits,
           COUNT(DISTINCT repo_full_name) as repos
    FROM commits
    GROUP BY month ORDER BY month
  `).all();
  res.json(rows);
});

// GET /api/prs — pull requests
contributionsRouter.get('/prs', (req: Request, res: Response) => {
  const { repo, state, from, to, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM pull_requests WHERE 1=1';
  const params: (string | number)[] = [];
  if (repo) { query += ' AND repo_full_name = ?'; params.push(repo as string); }
  if (state) { query += ' AND state = ?'; params.push(state as string); }
  if (from) { query += ' AND created_at >= ?'; params.push(from as string); }
  if (to) { query += ' AND created_at <= ?'; params.push(to as string); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/prs/stats — PR statistics
contributionsRouter.get('/prs/stats', (_req: Request, res: Response) => {
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month,
           COUNT(*) as total,
           SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged,
           SUM(CASE WHEN state='open' THEN 1 ELSE 0 END) as open
    FROM pull_requests GROUP BY month ORDER BY month
  `).all();

  const byRepo = db.prepare(`
    SELECT repo_full_name,
           COUNT(*) as total,
           SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged
    FROM pull_requests GROUP BY repo_full_name ORDER BY total DESC LIMIT 15
  `).all();

  const mergeRate = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged,
      ROUND(SUM(CASE WHEN merged=1 THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as merge_rate
    FROM pull_requests WHERE state != 'open'
  `).get();

  res.json({ monthly, byRepo, mergeRate });
});

// GET /api/reviews — PR reviews given
contributionsRouter.get('/reviews', (req: Request, res: Response) => {
  const { repo, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM pr_reviews WHERE 1=1';
  const params: (string | number)[] = [];
  if (repo) { query += ' AND repo_full_name = ?'; params.push(repo as string); }
  query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(query).all(...params));
});

// GET /api/issues — issues created
contributionsRouter.get('/issues', (req: Request, res: Response) => {
  const { repo, state, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM issues WHERE 1=1';
  const params: (string | number)[] = [];
  if (repo) { query += ' AND repo_full_name = ?'; params.push(repo as string); }
  if (state) { query += ' AND state = ?'; params.push(state as string); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(query).all(...params));
});

// GET /api/orgs — list orgs
contributionsRouter.get('/orgs', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT org_name, COUNT(*) as repo_count
    FROM repositories WHERE is_org=1 AND org_name IS NOT NULL
    GROUP BY org_name ORDER BY repo_count DESC
  `).all();
  res.json(rows);
});

// GET /api/languages — language breakdown
contributionsRouter.get('/languages', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT language, COUNT(*) as repos
    FROM repositories WHERE language IS NOT NULL
    GROUP BY language ORDER BY repos DESC
  `).all();
  res.json(rows);
});
