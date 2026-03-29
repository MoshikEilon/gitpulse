import { Router, Request, Response } from 'express';
import {
  getStats,
  getRepos,
  getCommits,
  getCommitHeatmap,
  getMonthlyCommits,
  getPRs,
  getPRStats,
  getOrgs,
  getLanguages,
} from '../github/queries.js';

export const contributionsRouter = Router();

// GET /api/contributions/stats
contributionsRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getStats();
    res.json({
      repos: { total: stats.repos, orgs: 0 },
      commits: { count: stats.commits, earliest: '', latest: '' },
      prs: { count: stats.prs, merged: stats.prsMerged, open: stats.prsOpen },
      reviews: { count: stats.reviews },
      issues: { count: stats.issues, open: 0 },
      mergeRate: stats.mergeRate,
    });
  } catch (err) {
    console.error('[contributions/stats]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/repos
contributionsRouter.get('/repos', async (req: Request, res: Response) => {
  try {
    const { org, limit = '50', offset = '0' } = req.query;
    const perPage = Number(limit);
    const page = Math.floor(Number(offset) / perPage) + 1;
    const { repos } = await getRepos({ org: org as string | undefined, page, perPage });
    res.json(repos);
  } catch (err) {
    console.error('[contributions/repos]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/commits
contributionsRouter.get('/commits', async (req: Request, res: Response) => {
  try {
    const { repo, from, to, limit = '50', offset = '0' } = req.query;
    const perPage = Number(limit);
    const page = Math.floor(Number(offset) / perPage) + 1;
    const { commits } = await getCommits({
      repo: repo as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      page,
      perPage,
    });
    res.json(commits);
  } catch (err) {
    console.error('[contributions/commits]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/commits/heatmap
contributionsRouter.get('/commits/heatmap', async (_req: Request, res: Response) => {
  try {
    const heatmap = await getCommitHeatmap();
    res.json(heatmap);
  } catch (err) {
    console.error('[contributions/commits/heatmap]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/commits/monthly
contributionsRouter.get('/commits/monthly', async (_req: Request, res: Response) => {
  try {
    const monthly = await getMonthlyCommits();
    res.json(monthly);
  } catch (err) {
    console.error('[contributions/commits/monthly]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/prs
contributionsRouter.get('/prs', async (req: Request, res: Response) => {
  try {
    const { repo, state, limit = '50', offset = '0' } = req.query;
    const perPage = Number(limit);
    const page = Math.floor(Number(offset) / perPage) + 1;
    const { prs } = await getPRs({
      state: state as string | undefined,
      repo: repo as string | undefined,
      page,
      perPage,
    });
    res.json(prs);
  } catch (err) {
    console.error('[contributions/prs]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/prs/stats
contributionsRouter.get('/prs/stats', async (_req: Request, res: Response) => {
  try {
    const { byMonth, byRepo, mergeRate } = await getPRStats();

    // Shape to match what the client expects
    const monthly = byMonth.map(m => ({
      month: m.month,
      total: m.prs,
      merged: m.merged,
      open: m.prs - m.merged,
    }));

    const byRepoShaped = byRepo.map(r => ({
      repo_full_name: r.repo,
      total: r.prs,
      merged: r.merged,
    }));

    const total = byRepo.reduce((s, r) => s + r.prs, 0);
    const mergedTotal = byRepo.reduce((s, r) => s + r.merged, 0);

    res.json({
      monthly,
      byRepo: byRepoShaped,
      mergeRate: {
        total,
        merged: mergedTotal,
        merge_rate: mergeRate,
      },
    });
  } catch (err) {
    console.error('[contributions/prs/stats]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/orgs
contributionsRouter.get('/orgs', async (_req: Request, res: Response) => {
  try {
    const orgs = await getOrgs();
    // Shape to match old API: { org_name, repo_count }
    res.json(orgs.map(o => ({ org_name: o.login, repo_count: o.repoCount })));
  } catch (err) {
    console.error('[contributions/orgs]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/languages
contributionsRouter.get('/languages', async (_req: Request, res: Response) => {
  try {
    const languages = await getLanguages();
    // Shape to match old API: { language, repos }
    res.json(languages.map(l => ({ language: l.language, repos: l.count })));
  } catch (err) {
    console.error('[contributions/languages]', err);
    res.status(500).json({ error: String(err) });
  }
});
