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
  getOrgList,
  getLanguages,
  getCommitsByRepo,
  getReviewsByRepo,
  getRepoList,
  getContributorList,
} from '../github/queries.js';

export const contributionsRouter = Router();

// GET /api/contributions/stats
contributionsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const { from, to, repo, author, org } = req.query;
    const stats = await getStats(
      from as string | undefined,
      to as string | undefined,
      repo as string | undefined,
      author as string | undefined,
      org as string | undefined,
    );
    res.json({
      repos: { total: stats.repos, orgs: 0 },
      commits: { count: stats.commits, earliest: '', latest: '' },
      prs: { count: stats.prs, merged: stats.prsMerged, open: stats.prsOpen },
      reviews: { count: stats.reviews },
      issues: { count: stats.issues, open: 0 },
      mergeRate: stats.mergeRate,
      linesAdded: stats.linesAdded,
      linesDeleted: stats.linesDeleted,
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
contributionsRouter.get('/commits/heatmap', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const heatmap = await getCommitHeatmap(from as string | undefined, to as string | undefined);
    res.json(heatmap);
  } catch (err) {
    console.error('[contributions/commits/heatmap]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/commits/monthly
contributionsRouter.get('/commits/monthly', async (req: Request, res: Response) => {
  try {
    const { from, to, repo, author, org } = req.query;
    const monthly = await getMonthlyCommits(
      from as string | undefined,
      to as string | undefined,
      repo as string | undefined,
      author as string | undefined,
      org as string | undefined,
    );
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
contributionsRouter.get('/prs/stats', async (req: Request, res: Response) => {
  try {
    const { from, to, repo, author, org } = req.query;
    const { byMonth, byRepo, mergeRate } = await getPRStats(
      from as string | undefined,
      to as string | undefined,
      repo as string | undefined,
      author as string | undefined,
      org as string | undefined,
    );

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

// GET /api/contributions/commits/by-repo
contributionsRouter.get('/commits/by-repo', async (req: Request, res: Response) => {
  try {
    const { from, to, repo, author, org } = req.query;
    const data = await getCommitsByRepo(
      from as string | undefined,
      to as string | undefined,
      repo as string | undefined,
      author as string | undefined,
      org as string | undefined,
    );
    res.json(data);
  } catch (err) {
    console.error('[contributions/commits/by-repo]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/reviews/by-repo
contributionsRouter.get('/reviews/by-repo', async (req: Request, res: Response) => {
  try {
    const { from, to, repo, author } = req.query;
    const data = await getReviewsByRepo(
      from as string | undefined,
      to as string | undefined,
      repo as string | undefined,
      author as string | undefined,
    );
    res.json(data);
  } catch (err) {
    console.error('[contributions/reviews/by-repo]', err);
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
contributionsRouter.get('/languages', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const languages = await getLanguages(from as string | undefined, to as string | undefined);
    // Shape to match old API: { language, repos }
    res.json(languages.map(l => ({ language: l.language, repos: l.count })));
  } catch (err) {
    console.error('[contributions/languages]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/repo-list
contributionsRouter.get('/repo-list', async (req: Request, res: Response) => {
  try {
    const { from, to, org } = req.query;
    const repos = await getRepoList(
      from as string | undefined,
      to as string | undefined,
      org as string | undefined,
    );
    res.json(repos);
  } catch (err) {
    console.error('[contributions/repo-list]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/contributor-list
contributionsRouter.get('/contributor-list', async (req: Request, res: Response) => {
  try {
    const { org, repo } = req.query;
    const contributors = await getContributorList(
      org as string | undefined,
      repo as string | undefined,
    );
    res.json(contributors);
  } catch (err) {
    console.error('[contributions/contributor-list]', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/contributions/org-list
contributionsRouter.get('/org-list', async (_req: Request, res: Response) => {
  try {
    const orgs = await getOrgList();
    res.json(orgs);
  } catch (err) {
    console.error('[contributions/org-list]', err);
    res.status(500).json({ error: String(err) });
  }
});
