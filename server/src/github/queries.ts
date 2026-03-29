import { graphql, USERNAME } from './client.js';
import { GraphqlResponseError } from '@octokit/graphql';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RepoItem {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  is_org: boolean;
  org_name?: string;
  description?: string;
  language?: string;
  stars: number;
  forks: number;
  is_private: boolean;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface CommitItem {
  sha: string;
  repo_full_name: string;
  message: string;
  committed_at: string;
  url: string;
}

export interface PRItem {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  state: string;
  merged: number;
  draft: number;
  created_at: string;
  merged_at?: string;
  additions: number;
  deletions: number;
  html_url: string;
}

// ---------------------------------------------------------------------------
// Internal GraphQL response shapes
// ---------------------------------------------------------------------------

interface GQLRepo {
  nameWithOwner: string;
  name: string;
  owner: { login: string; __typename?: string };
  description: string | null;
  primaryLanguage: { name: string } | null;
  stargazerCount: number;
  forkCount: number;
  isPrivate: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface GQLPullRequest {
  title: string;
  number: number;
  state: string;
  merged: boolean;
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  repository: { nameWithOwner: string };
  url: string;
  additions: number;
  deletions: number;
  databaseId: number;
}

interface ContributionDay {
  date: string;
  contributionCount: number;
}

interface ContributionWeek {
  contributionDays: ContributionDay[];
}

interface CommitContributionRepo {
  repository: { nameWithOwner: string; url: string };
  contributions: {
    totalCount: number;
    nodes: Array<{
      commitCount: number;
      occurredAt: string;
      repository: { nameWithOwner: string };
    }>;
  };
}

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

export async function getStats(): Promise<{
  repos: number;
  commits: number;
  prs: number;
  prsOpen: number;
  prsMerged: number;
  reviews: number;
  issues: number;
  mergeRate: number;
}> {
  const data = await graphql<{
    viewer: {
      repositories: { totalCount: number };
      contributionsCollection: {
        totalCommitContributions: number;
        totalPullRequestReviewContributions: number;
        totalIssueContributions: number;
      };
    };
  }>(`
    query {
      viewer {
        repositories(first: 1) { totalCount }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestReviewContributions
          totalIssueContributions
        }
      }
    }
  `);

  const cc = data.viewer.contributionsCollection;

  // Run PR count queries in parallel (total, merged, open)
  const [totalRes, mergedRes, openRes] = await Promise.all([
    graphql<{ search: { issueCount: number } }>(
      `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
      { q: `author:${USERNAME} is:pr` },
    ).catch(() => ({ search: { issueCount: 0 } })),
    graphql<{ search: { issueCount: number } }>(
      `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
      { q: `author:${USERNAME} is:pr is:merged` },
    ).catch(() => ({ search: { issueCount: 0 } })),
    graphql<{ search: { issueCount: number } }>(
      `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
      { q: `author:${USERNAME} is:pr is:open` },
    ).catch(() => ({ search: { issueCount: 0 } })),
  ]);

  const total = totalRes.search.issueCount;
  const merged = mergedRes.search.issueCount;
  const open = openRes.search.issueCount;
  const closed = total - open;
  const mergeRate = closed > 0 ? Math.round((merged / closed) * 1000) / 10 : 0;

  return {
    repos: data.viewer.repositories.totalCount,
    commits: cc.totalCommitContributions,
    prs: total,
    prsOpen: open,
    prsMerged: merged,
    reviews: cc.totalPullRequestReviewContributions,
    issues: cc.totalIssueContributions,
    mergeRate,
  };
}

// ---------------------------------------------------------------------------
// getRepos
// ---------------------------------------------------------------------------

export async function getRepos(options: {
  org?: string;
  page?: number;
  perPage?: number;
}): Promise<{ repos: RepoItem[]; total: number }> {
  const { org, page = 1, perPage = 50 } = options;

  // Fetch all contributed-to repos (up to 100)
  const data = await graphql<{
    viewer: {
      repositoriesContributedTo: {
        totalCount: number;
        nodes: GQLRepo[];
      };
    };
  }>(`
    query {
      viewer {
        repositoriesContributedTo(first: 100, includeUserRepositories: true) {
          totalCount
          nodes {
            nameWithOwner
            name
            owner { login }
            description
            primaryLanguage { name }
            stargazerCount
            forkCount
            isPrivate
            url
            createdAt
            updatedAt
          }
        }
      }
    }
  `);

  let nodes = data.viewer.repositoriesContributedTo.nodes;

  if (org) {
    nodes = nodes.filter(r => r.owner.login === org);
  }

  const allRepos: RepoItem[] = nodes.map((r, i) => ({
    id: i + 1,
    name: r.name,
    full_name: r.nameWithOwner,
    owner: r.owner.login,
    is_org: r.nameWithOwner.split('/')[0] !== USERNAME,
    org_name: r.nameWithOwner.split('/')[0] !== USERNAME ? r.owner.login : undefined,
    description: r.description ?? undefined,
    language: r.primaryLanguage?.name ?? undefined,
    stars: r.stargazerCount,
    forks: r.forkCount,
    is_private: r.isPrivate,
    html_url: r.url,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));

  const total = allRepos.length;
  const start = (page - 1) * perPage;
  const paginated = allRepos.slice(start, start + perPage);

  return { repos: paginated, total };
}

// ---------------------------------------------------------------------------
// getCommits
// ---------------------------------------------------------------------------

export async function getCommits(options: {
  repo?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}): Promise<{ commits: CommitItem[]; total: number }> {
  const { repo, page = 1, perPage = 50 } = options;

  const data = await graphql<{
    viewer: {
      contributionsCollection: {
        commitContributionsByRepository: CommitContributionRepo[];
      };
    };
  }>(`
    query {
      viewer {
        contributionsCollection {
          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner url }
            contributions(first: 100) {
              totalCount
              nodes {
                commitCount
                occurredAt
                repository { nameWithOwner }
              }
            }
          }
        }
      }
    }
  `);

  const allCommits: CommitItem[] = [];
  let idCounter = 1;

  for (const repoContrib of data.viewer.contributionsCollection.commitContributionsByRepository) {
    const repoName = repoContrib.repository.nameWithOwner;
    if (repo && repoName !== repo) continue;

    for (const node of repoContrib.contributions.nodes) {
      allCommits.push({
        sha: `${repoName}-${node.occurredAt}-${idCounter++}`,
        repo_full_name: repoName,
        message: `${node.commitCount} commit(s) on ${node.occurredAt.split('T')[0]}`,
        committed_at: node.occurredAt,
        url: repoContrib.repository.url,
      });
    }
  }

  // Sort by date descending
  allCommits.sort((a, b) => new Date(b.committed_at).getTime() - new Date(a.committed_at).getTime());

  const total = allCommits.length;
  const start = (page - 1) * perPage;
  const paginated = allCommits.slice(start, start + perPage);

  return { commits: paginated, total };
}

// ---------------------------------------------------------------------------
// getCommitHeatmap
// ---------------------------------------------------------------------------

export async function getCommitHeatmap(): Promise<Array<{ date: string; count: number }>> {
  const data = await graphql<{
    viewer: {
      contributionsCollection: {
        contributionCalendar: {
          weeks: ContributionWeek[];
        };
      };
    };
  }>(`
    query {
      viewer {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `);

  const result: Array<{ date: string; count: number }> = [];
  for (const week of data.viewer.contributionsCollection.contributionCalendar.weeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > 0) {
        result.push({ date: day.date, count: day.contributionCount });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// getMonthlyCommits
// ---------------------------------------------------------------------------

export async function getMonthlyCommits(): Promise<Array<{ month: string; commits: number; repos: number }>> {
  const heatmap = await getCommitHeatmap();

  const monthMap = new Map<string, { commits: number }>();
  for (const day of heatmap) {
    const month = day.date.slice(0, 7); // YYYY-MM
    const existing = monthMap.get(month) ?? { commits: 0 };
    existing.commits += day.count;
    monthMap.set(month, existing);
  }

  // Also get per-repo commit counts to get repos-per-month (approximate)
  const data = await graphql<{
    viewer: {
      contributionsCollection: {
        commitContributionsByRepository: CommitContributionRepo[];
      };
    };
  }>(`
    query {
      viewer {
        contributionsCollection {
          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner }
            contributions(first: 100) {
              nodes {
                commitCount
                occurredAt
              }
            }
          }
        }
      }
    }
  `);

  const reposByMonth = new Map<string, Set<string>>();
  for (const repoContrib of data.viewer.contributionsCollection.commitContributionsByRepository) {
    const repoName = repoContrib.repository.nameWithOwner;
    for (const node of repoContrib.contributions.nodes) {
      const month = node.occurredAt.slice(0, 7);
      if (!reposByMonth.has(month)) reposByMonth.set(month, new Set());
      reposByMonth.get(month)!.add(repoName);
    }
  }

  const months = Array.from(monthMap.keys()).sort();
  return months.map(month => ({
    month,
    commits: monthMap.get(month)!.commits,
    repos: reposByMonth.get(month)?.size ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// getPRs
// ---------------------------------------------------------------------------

export async function getPRs(options: {
  state?: string;
  repo?: string;
  page?: number;
  perPage?: number;
}): Promise<{ prs: PRItem[]; total: number }> {
  const { state, repo, page = 1, perPage = 50 } = options;

  let query = `author:${USERNAME} is:pr`;
  if (state === 'open') query += ' is:open';
  else if (state === 'closed') query += ' is:closed';
  else if (state === 'merged') query += ' is:merged';
  if (repo) query += ` repo:${repo}`;

  let rawData: { search: { issueCount: number; nodes: GQLPullRequest[] } } | null = null;

  try {
    rawData = await graphql<{ search: { issueCount: number; nodes: GQLPullRequest[] } }>(`
      query($q: String!) {
        search(query: $q, type: ISSUE, first: 100) {
          issueCount
          nodes {
            ... on PullRequest {
              databaseId
              title
              number
              state
              merged
              isDraft
              createdAt
              mergedAt
              repository { nameWithOwner }
              url
              additions
              deletions
            }
          }
        }
      }
    `, { q: query });
  } catch (err) {
    // GraphQL may return partial data alongside errors (e.g., mondaycom org blocks PAT access)
    if (err instanceof GraphqlResponseError && err.data?.search) {
      rawData = err.data as { search: { issueCount: number; nodes: GQLPullRequest[] } };
    } else {
      throw err;
    }
  }

  const data = rawData!;

  const allPRs: PRItem[] = data.search.nodes
    .filter((n): n is GQLPullRequest => n !== null && 'title' in n)
    .map(pr => ({
      id: pr.databaseId,
      repo_full_name: pr.repository.nameWithOwner,
      number: pr.number,
      title: pr.title,
      state: pr.state.toLowerCase(),
      merged: pr.merged ? 1 : 0,
      draft: pr.isDraft ? 1 : 0,
      created_at: pr.createdAt,
      merged_at: pr.mergedAt ?? undefined,
      additions: pr.additions,
      deletions: pr.deletions,
      html_url: pr.url,
    }));

  const total = data.search.issueCount;
  const start = (page - 1) * perPage;
  const paginated = allPRs.slice(start, start + perPage);

  return { prs: paginated, total };
}

// ---------------------------------------------------------------------------
// getPRStats
// ---------------------------------------------------------------------------

export async function getPRStats(): Promise<{
  byMonth: Array<{ month: string; prs: number; merged: number }>;
  byRepo: Array<{ repo: string; prs: number; merged: number }>;
  mergeRate: number;
}> {
  const { prs } = await getPRs({ perPage: 100 });

  // By month
  const monthMap = new Map<string, { prs: number; merged: number }>();
  const repoMap = new Map<string, { prs: number; merged: number }>();

  for (const pr of prs) {
    const month = pr.created_at.slice(0, 7);
    const mEntry = monthMap.get(month) ?? { prs: 0, merged: 0 };
    mEntry.prs++;
    if (pr.merged) mEntry.merged++;
    monthMap.set(month, mEntry);

    const rEntry = repoMap.get(pr.repo_full_name) ?? { prs: 0, merged: 0 };
    rEntry.prs++;
    if (pr.merged) rEntry.merged++;
    repoMap.set(pr.repo_full_name, rEntry);
  }

  const byMonth = Array.from(monthMap.entries())
    .map(([month, v]) => ({ month, prs: v.prs, merged: v.merged }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const byRepo = Array.from(repoMap.entries())
    .map(([repo, v]) => ({ repo, prs: v.prs, merged: v.merged }))
    .sort((a, b) => b.prs - a.prs)
    .slice(0, 15);

  const total = prs.length;
  const merged = prs.filter(p => p.merged).length;
  const closed = prs.filter(p => p.state === 'closed' || p.state === 'merged' || p.merged).length;
  const mergeRate = closed > 0 ? Math.round((merged / closed) * 1000) / 10 : 0;

  return { byMonth, byRepo, mergeRate };
}

// ---------------------------------------------------------------------------
// getOrgs
// ---------------------------------------------------------------------------

export async function getOrgs(): Promise<Array<{ login: string; repoCount: number }>> {
  // Derive orgs from contributed-to repos — no read:org scope needed
  const { repos } = await getRepos({ perPage: 200 });

  const orgMap = new Map<string, number>();
  for (const repo of repos) {
    if (repo.is_org && repo.org_name) {
      orgMap.set(repo.org_name, (orgMap.get(repo.org_name) ?? 0) + 1);
    }
  }

  return Array.from(orgMap.entries())
    .map(([login, repoCount]) => ({ login, repoCount }))
    .sort((a, b) => b.repoCount - a.repoCount);
}

// ---------------------------------------------------------------------------
// getLanguages
// ---------------------------------------------------------------------------

export async function getLanguages(): Promise<Array<{ language: string; count: number }>> {
  const { repos } = await getRepos({ perPage: 100 });

  const langMap = new Map<string, number>();
  for (const repo of repos) {
    if (repo.language) {
      langMap.set(repo.language, (langMap.get(repo.language) ?? 0) + 1);
    }
  }

  return Array.from(langMap.entries())
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// getContributionContext  (for AI chat)
// ---------------------------------------------------------------------------

export async function getContributionContext(): Promise<string> {
  const [stats, topRepos, monthly, languages, { prs }] = await Promise.all([
    getStats(),
    getRepos({ perPage: 10 }),
    getMonthlyCommits(),
    getLanguages(),
    getPRs({ perPage: 20 }),
  ]);

  const last12Monthly = monthly.slice(-12);
  const recentPRs = prs.slice(0, 20);

  return `
You are GitPulse AI — an assistant with full access to the user's GitHub contribution data.
The user is ${USERNAME}.

## Summary Statistics
- Total repos: ${stats.repos}
- Total commits (past year): ${stats.commits}
- Total PRs created: ${stats.prs}
- Total PR reviews given: ${stats.reviews}
- Total issues opened: ${stats.issues}
- PR merge rate: ${stats.mergeRate}%

## Top Repositories
${topRepos.repos.slice(0, 10).map(r => `- ${r.full_name} (${r.language ?? 'unknown'}, ${r.stars} stars)`).join('\n')}

## Monthly Activity (last 12 months)
${last12Monthly.map(m => `- ${m.month}: ${m.commits} contributions`).join('\n')}

## Languages
${languages.slice(0, 10).map(l => `- ${l.language}: ${l.count} repos`).join('\n')}

## Recent PRs
${recentPRs.map(p => `- [${p.state}${p.merged ? '/merged' : ''}] ${p.repo_full_name}#${p.number}: ${p.title} (${p.created_at?.split('T')[0]})`).join('\n')}

Answer questions about the user's contributions, code activity, patterns, and insights.
Be specific and use the data above. For questions needing more detail, explain what data is available.
`.trim();
}
