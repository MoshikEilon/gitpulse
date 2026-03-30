import { graphql, octokit, USERNAME } from './client.js';
import { GraphqlResponseError } from '@octokit/graphql';
import { withCache } from './cache.js';

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
// Helper: build contributionsCollection arguments string
// ---------------------------------------------------------------------------

function toDateTime(d: string): string {
  // Ensure full ISO 8601 DateTime — if only a date is given, append time
  return d.includes('T') ? d : `${d}T00:00:00Z`;
}

function ccArgs(from?: string, to?: string): string {
  const parts: string[] = [];
  if (from) parts.push(`from: "${toDateTime(from)}"`);
  if (to) parts.push(`to: "${toDateTime(to)}"`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

// ---------------------------------------------------------------------------
// Helper: build org scope for unfiltered queries
// Returns e.g. "org:DaPulse org:mondaycom" or '' if user has no orgs
// ---------------------------------------------------------------------------

let _cachedOrgFragment: string | null = null;

async function getOrgQueryFragment(): Promise<string> {
  if (_cachedOrgFragment !== null) return _cachedOrgFragment;
  try {
    const data = await graphql<{
      viewer: {
        organizations: {
          nodes: Array<{ login: string }>;
        };
      };
    }>(`
      query {
        viewer {
          organizations(first: 100) {
            nodes { login }
          }
        }
      }
    `);
    const logins = data.viewer.organizations.nodes.map(o => o.login);
    _cachedOrgFragment = logins.length > 0 ? logins.map(l => `org:${l}`).join(' ') : '';
  } catch {
    _cachedOrgFragment = '';
  }
  return _cachedOrgFragment;
}

// ---------------------------------------------------------------------------
// getLinesOfCode  (paginate through PR search, sum additions + deletions)
// ---------------------------------------------------------------------------

interface LocSearchResult {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ additions?: number; deletions?: number } | null>;
  };
}

export async function getLinesOfCode(from?: string, to?: string, repo?: string, author?: string, org?: string): Promise<{ linesAdded: number; linesDeleted: number }> {
  let dateRange = '';
  if (from && to) dateRange = ` created:${from.slice(0, 10)}..${to.slice(0, 10)}`;
  else if (from) dateRange = ` created:>=${from.slice(0, 10)}`;
  else if (to) dateRange = ` created:<=${to.slice(0, 10)}`;

  const repoFilter = repo ? ` repo:${repo}` : '';
  let baseQuery: string;
  if (repo && !org && !author) {
    // Specific repo, no author filter — show all contributors
    baseQuery = `repo:${repo} is:pr${dateRange}`;
  } else if (org && !author) {
    baseQuery = `org:${org} is:pr${repoFilter}${dateRange}`;
  } else if (author) {
    baseQuery = org
      ? `author:${author} org:${org} is:pr${repoFilter}${dateRange}`
      : `author:${author} is:pr${repoFilter}${dateRange}`;
  } else {
    // Unfiltered: scope to user's orgs, all contributors
    const orgFragment = await getOrgQueryFragment();
    baseQuery = orgFragment
      ? `${orgFragment} is:pr${repoFilter}${dateRange}`
      : `author:${USERNAME} is:pr${repoFilter}${dateRange}`;
  }

  let linesAdded = 0;
  let linesDeleted = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  const LOC_QUERY = `
    query($q: String!, $after: String) {
      search(query: $q, type: ISSUE, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on PullRequest {
            additions
            deletions
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    let rawData: LocSearchResult | null = null;

    try {
      rawData = await graphql<LocSearchResult>(LOC_QUERY, {
        q: baseQuery,
        after: cursor ?? undefined,
      });
    } catch (err) {
      if (err instanceof GraphqlResponseError && err.data?.search) {
        rawData = err.data as LocSearchResult;
      } else {
        throw err;
      }
    }

    if (!rawData) break;

    for (const node of rawData.search.nodes) {
      if (node && node.additions != null) {
        linesAdded += node.additions;
        linesDeleted += node.deletions ?? 0;
      }
    }

    hasNextPage = rawData.search.pageInfo.hasNextPage;
    cursor = rawData.search.pageInfo.endCursor;
  }

  return { linesAdded, linesDeleted };
}

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

export async function getStats(from?: string, to?: string, repo?: string, author?: string, org?: string): Promise<{
  repos: number;
  commits: number;
  prs: number;
  prsOpen: number;
  prsMerged: number;
  reviews: number;
  issues: number;
  mergeRate: number;
  linesAdded: number;
  linesDeleted: number;
}> {
  // Normalize params for a deterministic cache key
  const fromN = from ?? '';
  const toN = to ?? '';
  const repoN = repo ?? '';
  const authorN = author ?? '';
  const orgN = org ?? '';
  const cacheKey = `stats:${fromN}:${toN}:${orgN}:${repoN}:${authorN}`;

  return withCache(cacheKey, 5 * 60 * 1000, async () => {
    const repoFilter = repo ? ` repo:${repo}` : '';

    let dateRange = '';
    if (from && to) dateRange = ` created:${from.slice(0, 10)}..${to.slice(0, 10)}`;
    else if (from) dateRange = ` created:>=${from.slice(0, 10)}`;
    else if (to) dateRange = ` created:<=${to.slice(0, 10)}`;

    // Build the actor filter prefix (async to support unfiltered org-fragment lookup)
    async function buildActorFilter(): Promise<string> {
      if (repo && !org && !author) {
        // Specific repo, show all contributors
        return `repo:${repo}`;
      }
      if (org && !author) return `org:${org}`;
      if (author) return org ? `author:${author} org:${org}` : `author:${author}`;
      // Unfiltered: scope to user's orgs, all contributors
      const orgFragment = await getOrgQueryFragment();
      return orgFragment || `author:${USERNAME}`;
    }
    const actorFilter = await buildActorFilter();

    // Fetch repos count + first contributionsCollection window in a single batched query
    // (only when there's no author/org override, which is the viewer-only mode)
    let reposCount = 0;
    let ccData = { totalCommitContributions: 0, totalPullRequestReviewContributions: 0, totalIssueContributions: 0 };

    if (!author && !org) {
      // Split into yearly windows to work around GitHub's 1-year limit on contributionsCollection
      const start = from ? new Date(from) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
      const end = to ? new Date(to) : new Date();
      const windows: Array<{ from: string; to: string }> = [];
      let windowCursor = new Date(start);
      while (windowCursor < end) {
        const windowEnd = new Date(windowCursor);
        windowEnd.setFullYear(windowEnd.getFullYear() + 1);
        windows.push({ from: windowCursor.toISOString(), to: (windowEnd < end ? windowEnd : end).toISOString() });
        windowCursor = windowEnd;
      }

      // Combine repos count + first window into one batched query
      const firstWindowCC = ccArgs(windows[0].from, windows[0].to);
      const batchedFirstQuery = `
        query {
          viewer {
            repositories(first: 1) { totalCount }
            contributionsCollection${firstWindowCC} {
              totalCommitContributions
              totalPullRequestReviewContributions
              totalIssueContributions
            }
          }
        }
      `;

      type FirstBatchResult = {
        viewer: {
          repositories: { totalCount: number };
          contributionsCollection: {
            totalCommitContributions: number;
            totalPullRequestReviewContributions: number;
            totalIssueContributions: number;
          };
        };
      };

      const firstBatch = await graphql<FirstBatchResult>(batchedFirstQuery).catch(() => null);
      if (firstBatch) {
        reposCount = firstBatch.viewer.repositories.totalCount;
        ccData = {
          totalCommitContributions: firstBatch.viewer.contributionsCollection.totalCommitContributions,
          totalPullRequestReviewContributions: firstBatch.viewer.contributionsCollection.totalPullRequestReviewContributions,
          totalIssueContributions: firstBatch.viewer.contributionsCollection.totalIssueContributions,
        };
      }

      // Fetch remaining windows (if any) in parallel
      if (windows.length > 1) {
        const remainingWindows = windows.slice(1);
        const windowResults = await Promise.all(remainingWindows.map(w => {
          const cc = ccArgs(w.from, w.to);
          return graphql<{
            viewer: {
              contributionsCollection: {
                totalCommitContributions: number;
                totalPullRequestReviewContributions: number;
                totalIssueContributions: number;
              };
            };
          }>(`
            query {
              viewer {
                contributionsCollection${cc} {
                  totalCommitContributions
                  totalPullRequestReviewContributions
                  totalIssueContributions
                }
              }
            }
          `);
        }));

        ccData = windowResults.reduce((acc, r) => ({
          totalCommitContributions: acc.totalCommitContributions + r.viewer.contributionsCollection.totalCommitContributions,
          totalPullRequestReviewContributions: acc.totalPullRequestReviewContributions + r.viewer.contributionsCollection.totalPullRequestReviewContributions,
          totalIssueContributions: acc.totalIssueContributions + r.viewer.contributionsCollection.totalIssueContributions,
        }), ccData);
      }
    }

    // For authenticated user without author/org override, use contributionsCollection
    let commitCount = ccData.totalCommitContributions;

    // When repo is set (and no author/org), filter commit count by repo
    if (repo && !author && !org) {
      const repoCommits = await getCommitsByRepo(from, to);
      const repoEntry = repoCommits.find(r => r.repo === repo);
      commitCount = repoEntry?.commits ?? 0;
    }

    // When author or org filter is active, count commits via REST search API
    // (GraphQL search does not support type: COMMIT)
    if (author || org) {
      let commitQuery = '';
      if (author && org) commitQuery = `author:${author} org:${org}`;
      else if (author) commitQuery = `author:${author}`;
      else commitQuery = `org:${org}`;
      if (repo) commitQuery += ` repo:${repo}`;
      if (from && to) commitQuery += ` committer-date:${from.slice(0, 10)}..${to.slice(0, 10)}`;
      else if (from) commitQuery += ` committer-date:>=${from.slice(0, 10)}`;
      else if (to) commitQuery += ` committer-date:<=${to.slice(0, 10)}`;

      try {
        const res = await octokit.search.commits({ q: commitQuery, per_page: 1 });
        commitCount = res.data.total_count;
      } catch {
        commitCount = 0;
      }
    }

    // When actorFilter already encodes the repo (repo-only mode), don't double-add repoFilter
    const effectiveRepoFilter = actorFilter.startsWith('repo:') ? '' : repoFilter;

    // Batch total + merged PR counts into a single GraphQL request using aliases
    const prBatchQuery = `
      query($q1: String!, $q2: String!) {
        total: search(query: $q1, type: ISSUE, first: 1) { issueCount }
        merged: search(query: $q2, type: ISSUE, first: 1) { issueCount }
      }
    `;
    type PRBatchResult = {
      total: { issueCount: number };
      merged: { issueCount: number };
    };

    // Fetch repos count for org/author filters via REST
    if ((author || org) && reposCount === 0) {
      try {
        if (org) {
          const res = await octokit.orgs.get({ org });
          reposCount = res.data.public_repos + (res.data.total_private_repos ?? 0);
        } else if (author) {
          const res = await octokit.users.getByUsername({ username: author });
          reposCount = res.data.public_repos;
        }
      } catch { reposCount = 0; }
    }

    // Reviews: use REST search for reviewed PRs when author is set
    let reviewCount = (author || org) ? 0 : ccData.totalPullRequestReviewContributions;
    if (author) {
      let reviewQuery = `reviewed-by:${author}`;
      if (org) reviewQuery += ` org:${org}`;
      if (repo) reviewQuery += ` repo:${repo}`;
      reviewQuery += ` is:pr${dateRange}`;
      reviewCount = await graphql<{ search: { issueCount: number } }>(
        `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
        { q: reviewQuery },
      ).then(r => r.search.issueCount).catch(() => 0);
    }

    const [prBatch, openRes, loc] = await Promise.all([
      graphql<PRBatchResult>(prBatchQuery, {
        q1: `${actorFilter} is:pr${effectiveRepoFilter}${dateRange}`,
        q2: `${actorFilter} is:pr is:merged${effectiveRepoFilter}${dateRange}`,
      }).catch(() => ({ total: { issueCount: 0 }, merged: { issueCount: 0 } })),
      graphql<{ search: { issueCount: number } }>(
        `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
        { q: `${actorFilter} is:pr is:open${effectiveRepoFilter}${dateRange}` },
      ).catch(() => ({ search: { issueCount: 0 } })),
      getLinesOfCode(from, to, repo, author, org),
    ]);

    const total = prBatch.total.issueCount;
    const merged = prBatch.merged.issueCount;
    const open = openRes.search.issueCount;
    const closed = total - open;
    const mergeRate = closed > 0 ? Math.round((merged / closed) * 1000) / 10 : 0;

    return {
      repos: reposCount,
      commits: commitCount,
      prs: total,
      prsOpen: open,
      prsMerged: merged,
      reviews: reviewCount,
      issues: (author || org) ? 0 : ccData.totalIssueContributions,
      mergeRate,
      linesAdded: loc.linesAdded,
      linesDeleted: loc.linesDeleted,
    };
  });
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
  const orgN = org ?? '';
  const cacheKey = `repoList:${orgN}:${page}:${perPage}`;

  return withCache(cacheKey, 15 * 60 * 1000, async () => {
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
  });
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
  const { repo, from, to, page = 1, perPage = 50 } = options;
  const cc = ccArgs(from, to);

  const data = await graphql<{
    viewer: {
      contributionsCollection: {
        commitContributionsByRepository: CommitContributionRepo[];
      };
    };
  }>(`
    query {
      viewer {
        contributionsCollection${cc} {
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

export async function getCommitHeatmap(from?: string, to?: string): Promise<Array<{ date: string; count: number }>> {
  const cc = ccArgs(from, to);

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
        contributionsCollection${cc} {
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

export async function getMonthlyCommits(from?: string, to?: string, repo?: string, author?: string, org?: string): Promise<Array<{ month: string; commits: number; repos: number }>> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const repoN = repo ?? '';
  const authorN = author ?? '';
  const orgN = org ?? '';
  const cacheKey = `monthlyCommits:${fromN}:${toN}:${orgN}:${repoN}:${authorN}`;

  return withCache(cacheKey, 5 * 60 * 1000, async () => {
    // Use PR search as proxy for monthly activity.
    // Split into yearly windows to avoid GitHub's 1000-result search cap.
    const repoFilter = repo ? ` repo:${repo}` : '';

    async function buildBaseQuery(windowFrom: string, windowTo: string): Promise<string> {
      const dateRange = ` created:${windowFrom}..${windowTo}`;
      if (repo && !org && !author) return `repo:${repo} is:pr${dateRange}`;
      if (org && !author) return `org:${org} is:pr${repoFilter}${dateRange}`;
      if (author) return org
        ? `author:${author} org:${org} is:pr${repoFilter}${dateRange}`
        : `author:${author} is:pr${repoFilter}${dateRange}`;
      const orgFragment = await getOrgQueryFragment();
      return orgFragment
        ? `${orgFragment} is:pr${repoFilter}${dateRange}`
        : `author:${USERNAME} is:pr${repoFilter}${dateRange}`;
    }

    // Build yearly windows
    const start = from ? new Date(from) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
    const end = to ? new Date(to) : new Date();
    const windows: Array<{ from: string; to: string }> = [];
    let cur = new Date(start);
    while (cur < end) {
      const next = new Date(cur);
      next.setFullYear(next.getFullYear() + 1);
      windows.push({ from: cur.toISOString().slice(0, 10), to: (next < end ? next : end).toISOString().slice(0, 10) });
      cur = next;
    }

    interface PRMonthNode { createdAt?: string; }
    interface PRMonthResult {
      search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<PRMonthNode | null> };
    }
    const PR_MONTH_QUERY = `
      query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ... on PullRequest { createdAt } }
        }
      }
    `;

    const monthMap = new Map<string, number>();

    // Fetch each yearly window sequentially to respect rate limits
    for (const w of windows) {
      const q = await buildBaseQuery(w.from, w.to);
      let cursor: string | null = null;
      let hasNextPage = true;
      while (hasNextPage) {
        let rawData: PRMonthResult | null = null;
        try {
          rawData = await graphql<PRMonthResult>(PR_MONTH_QUERY, { q, after: cursor ?? undefined });
        } catch (err) {
          if (err instanceof GraphqlResponseError && err.data?.search) {
            rawData = err.data as PRMonthResult;
          } else break;
        }
        if (!rawData) break;
        for (const node of rawData.search.nodes) {
          if (node?.createdAt) {
            const month = node.createdAt.slice(0, 7);
            monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
          }
        }
        hasNextPage = rawData.search.pageInfo.hasNextPage;
        cursor = rawData.search.pageInfo.endCursor;
      }
    }

    const months = Array.from(monthMap.keys()).sort();
    return months.map(month => ({ month, commits: monthMap.get(month)!, repos: 0 }));
  });
}

// ---------------------------------------------------------------------------
// getPRs
// ---------------------------------------------------------------------------

export async function getPRs(options: {
  state?: string;
  repo?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}): Promise<{ prs: PRItem[]; total: number }> {
  const { state, repo, from, to, page = 1, perPage = 50 } = options;

  let query = `author:${USERNAME} is:pr`;
  if (state === 'open') query += ' is:open';
  else if (state === 'closed') query += ' is:closed';
  else if (state === 'merged') query += ' is:merged';
  if (repo) query += ` repo:${repo}`;
  if (from && to) query += ` created:${from.slice(0, 10)}..${to.slice(0, 10)}`;
  else if (from) query += ` created:>=${from.slice(0, 10)}`;
  else if (to) query += ` created:<=${to.slice(0, 10)}`;

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

export async function getPRStats(from?: string, to?: string, repo?: string, author?: string, org?: string): Promise<{
  byMonth: Array<{ month: string; prs: number; merged: number }>;
  byRepo: Array<{ repo: string; prs: number; merged: number }>;
  mergeRate: number;
}> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const repoN = repo ?? '';
  const authorN = author ?? '';
  const orgN = org ?? '';
  const cacheKey = `prStats:${fromN}:${toN}:${orgN}:${repoN}:${authorN}`;

  return withCache(cacheKey, 5 * 60 * 1000, async () => {
    const repoFilter = repo ? ` repo:${repo}` : '';

    async function buildBaseQuery(windowFrom: string, windowTo: string): Promise<string> {
      const dateRange = ` created:${windowFrom}..${windowTo}`;
      if (repo && !org && !author) return `repo:${repo} is:pr${dateRange}`;
      if (org && !author) return `org:${org} is:pr${repoFilter}${dateRange}`;
      if (author) return org
        ? `author:${author} org:${org} is:pr${repoFilter}${dateRange}`
        : `author:${author} is:pr${repoFilter}${dateRange}`;
      const orgFragment = await getOrgQueryFragment();
      return orgFragment
        ? `${orgFragment} is:pr${repoFilter}${dateRange}`
        : `author:${USERNAME} is:pr${repoFilter}${dateRange}`;
    }

    // Split into yearly windows to avoid GitHub's 1000-result search cap
    const start = from ? new Date(from) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
    const end = to ? new Date(to) : new Date();
    const windows: Array<{ from: string; to: string }> = [];
    let cur = new Date(start);
    while (cur < end) {
      const next = new Date(cur);
      next.setFullYear(next.getFullYear() + 1);
      windows.push({ from: cur.toISOString().slice(0, 10), to: (next < end ? next : end).toISOString().slice(0, 10) });
      cur = next;
    }

    const PR_STATS_QUERY = `
      query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on PullRequest {
              createdAt
              merged
              state
              repository { nameWithOwner }
            }
          }
        }
      }
    `;

    interface PRStatsNode {
      createdAt?: string;
      merged?: boolean;
      state?: string;
      repository?: { nameWithOwner: string };
    }
    interface PRStatsResult {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<PRStatsNode | null>;
      };
    }

    const allPRs: Array<{ createdAt: string; merged: boolean; state: string; repo: string }> = [];

    for (const w of windows) {
      const baseQuery = await buildBaseQuery(w.from, w.to);
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        let rawData: PRStatsResult | null = null;
        try {
          rawData = await graphql<PRStatsResult>(PR_STATS_QUERY, {
            q: baseQuery,
            after: cursor ?? undefined,
          });
        } catch (err) {
          if (err instanceof GraphqlResponseError && err.data?.search) {
            rawData = err.data as PRStatsResult;
          } else break;
        }

        if (!rawData) break;

        for (const node of rawData.search.nodes) {
          if (node && node.createdAt && node.repository) {
            allPRs.push({
              createdAt: node.createdAt,
              merged: node.merged ?? false,
              state: node.state ?? 'open',
              repo: node.repository.nameWithOwner,
            });
          }
        }

        hasNextPage = rawData.search.pageInfo.hasNextPage;
        cursor = rawData.search.pageInfo.endCursor;
      }
    }

    // By month
    const monthMap = new Map<string, { prs: number; merged: number }>();
    const repoMap = new Map<string, { prs: number; merged: number }>();

    for (const pr of allPRs) {
      const month = pr.createdAt.slice(0, 7);
      const mEntry = monthMap.get(month) ?? { prs: 0, merged: 0 };
      mEntry.prs++;
      if (pr.merged) mEntry.merged++;
      monthMap.set(month, mEntry);

      const rEntry = repoMap.get(pr.repo) ?? { prs: 0, merged: 0 };
      rEntry.prs++;
      if (pr.merged) rEntry.merged++;
      repoMap.set(pr.repo, rEntry);
    }

    const byMonth = Array.from(monthMap.entries())
      .map(([month, v]) => ({ month, prs: v.prs, merged: v.merged }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const byRepo = Array.from(repoMap.entries())
      .map(([repo, v]) => ({ repo, prs: v.prs, merged: v.merged }))
      .sort((a, b) => b.prs - a.prs)
      .slice(0, 15);

    const total = allPRs.length;
    const merged = allPRs.filter(p => p.merged).length;
    const closed = allPRs.filter(p => p.state === 'closed' || p.state === 'merged' || p.merged).length;
    const mergeRate = closed > 0 ? Math.round((merged / closed) * 1000) / 10 : 0;

    return { byMonth, byRepo, mergeRate };
  });
}

// ---------------------------------------------------------------------------
// getCommitsByRepo
// ---------------------------------------------------------------------------

export async function getCommitsByRepo(from?: string, to?: string, repo?: string, author?: string, org?: string): Promise<Array<{ repo: string; commits: number }>> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const repoN = repo ?? '';
  const authorN = author ?? '';
  const orgN = org ?? '';
  const cacheKey = `commitsByRepo:${fromN}:${toN}:${orgN}:${repoN}:${authorN}`;

  return withCache(cacheKey, 5 * 60 * 1000, async () => {
    // Use PR search as proxy for per-repo activity (covers all contributors/orgs).
    let dateRange = '';
    if (from && to) dateRange = ` created:${from.slice(0, 10)}..${to.slice(0, 10)}`;
    else if (from) dateRange = ` created:>=${from.slice(0, 10)}`;
    else if (to) dateRange = ` created:<=${to.slice(0, 10)}`;
    const repoFilter = repo ? ` repo:${repo}` : '';

    let baseQuery: string;
    if (repo && !org && !author) {
      baseQuery = `repo:${repo} is:pr${dateRange}`;
    } else if (org && !author) {
      baseQuery = `org:${org} is:pr${repoFilter}${dateRange}`;
    } else if (author) {
      baseQuery = org
        ? `author:${author} org:${org} is:pr${repoFilter}${dateRange}`
        : `author:${author} is:pr${repoFilter}${dateRange}`;
    } else {
      // Unfiltered: scope to user's orgs, all contributors
      const orgFragment = await getOrgQueryFragment();
      baseQuery = orgFragment
        ? `${orgFragment} is:pr${repoFilter}${dateRange}`
        : `author:${USERNAME} is:pr${repoFilter}${dateRange}`;
    }

    interface PRRepoNode {
      repository?: { nameWithOwner: string };
    }
    interface PRRepoResult {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<PRRepoNode | null>;
      };
    }

    const repoMap = new Map<string, number>();
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      let rawData: PRRepoResult | null = null;
      try {
        rawData = await graphql<PRRepoResult>(`
          query($q: String!, $after: String) {
            search(query: $q, type: ISSUE, first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { ... on PullRequest { repository { nameWithOwner } } }
            }
          }
        `, { q: baseQuery, after: cursor ?? undefined });
      } catch (err) {
        if (err instanceof GraphqlResponseError && err.data?.search) {
          rawData = err.data as PRRepoResult;
        } else {
          throw err;
        }
      }
      if (!rawData) break;
      for (const node of rawData.search.nodes) {
        if (node && node.repository) {
          const r = node.repository.nameWithOwner;
          repoMap.set(r, (repoMap.get(r) ?? 0) + 1);
        }
      }
      hasNextPage = rawData.search.pageInfo.hasNextPage;
      cursor = rawData.search.pageInfo.endCursor;
    }

    let result = Array.from(repoMap.entries()).map(([r, commits]) => ({ repo: r, commits })).sort((a, b) => b.commits - a.commits);
    if (repo) result = result.filter(r => r.repo === repo);
    return result;
  });
}

// ---------------------------------------------------------------------------
// getReviewsByRepo
// ---------------------------------------------------------------------------

export async function getReviewsByRepo(from?: string, to?: string, repo?: string, author?: string): Promise<Array<{ repo: string; reviews: number }>> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const repoN = repo ?? '';
  const authorN = author ?? '';
  const cacheKey = `reviewsByRepo:${fromN}:${toN}:${repoN}:${authorN}`;

  return withCache(cacheKey, 5 * 60 * 1000, async () => {
    let dateFilter = '';
    if (from && to) dateFilter = ` updated:${from.slice(0, 10)}..${to.slice(0, 10)}`;
    else if (from) dateFilter = ` updated:>=${from.slice(0, 10)}`;
    else if (to) dateFilter = ` updated:<=${to.slice(0, 10)}`;

    const effectiveAuthor = author || USERNAME;
    const repoFilter = repo ? ` repo:${repo}` : '';
    const baseQuery = `reviewed-by:${effectiveAuthor} is:pr${repoFilter}${dateFilter}`;

    const REVIEWS_QUERY = `
      query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on PullRequest {
              repository { nameWithOwner }
              reviews(author: "${effectiveAuthor}", first: 100) {
                totalCount
              }
            }
          }
        }
      }
    `;

    interface ReviewsNode {
      repository?: { nameWithOwner: string };
      reviews?: { totalCount: number };
    }
    interface ReviewsResult {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<ReviewsNode | null>;
      };
    }

    const repoMap = new Map<string, number>();
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      let rawData: ReviewsResult | null = null;
      try {
        rawData = await graphql<ReviewsResult>(REVIEWS_QUERY, {
          q: baseQuery,
          after: cursor ?? undefined,
        });
      } catch (err) {
        if (err instanceof GraphqlResponseError && err.data?.search) {
          rawData = err.data as ReviewsResult;
        } else {
          throw err;
        }
      }

      if (!rawData) break;

      for (const node of rawData.search.nodes) {
        if (node && node.repository && node.reviews) {
          const r = node.repository.nameWithOwner;
          repoMap.set(r, (repoMap.get(r) ?? 0) + node.reviews.totalCount);
        }
      }

      hasNextPage = rawData.search.pageInfo.hasNextPage;
      cursor = rawData.search.pageInfo.endCursor;
    }

    return Array.from(repoMap.entries())
      .map(([repo, reviews]) => ({ repo, reviews }))
      .sort((a, b) => b.reviews - a.reviews);
  });
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
// getOrgList  (for org filter dropdown — just org login names)
// ---------------------------------------------------------------------------

export async function getOrgList(): Promise<string[]> {
  return withCache('orgList', 60 * 60 * 1000, async () => {
    // Use viewer.organizations for a complete list (also populates cache for org fragment)
    try {
      const data = await graphql<{
        viewer: { organizations: { nodes: Array<{ login: string }> } };
      }>(`
        query {
          viewer {
            organizations(first: 100) {
              nodes { login }
            }
          }
        }
      `);
      const logins = data.viewer.organizations.nodes.map(o => o.login).sort();
      // Update in-memory org fragment cache
      _cachedOrgFragment = logins.length > 0 ? logins.map(l => `org:${l}`).join(' ') : '';
      return logins;
    } catch {
      // Fallback: derive from contributed repos
      const orgs = await getOrgs();
      return orgs.map(o => o.login);
    }
  });
}

// ---------------------------------------------------------------------------
// getLanguages
// ---------------------------------------------------------------------------

export async function getLanguages(from?: string, to?: string): Promise<Array<{ language: string; count: number }>> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const cacheKey = `languages:${fromN}:${toN}`;

  return withCache(cacheKey, 15 * 60 * 1000, async () => {
    // If date range provided, use commitContributionsByRepository to filter repos in range
    if (from || to) {
      const reposInRange = await getCommitsByRepo(from, to);
      if (reposInRange.length === 0) return [];

      // Fetch language info for each repo in range using GraphQL
      const repoNames = reposInRange.map(r => r.repo);

      // Batch query: fetch primaryLanguage for each repo
      // GitHub GraphQL supports aliased repo lookups
      const aliasedQueries = repoNames.slice(0, 50).map((fullName, i) => {
        const [owner, name] = fullName.split('/');
        return `repo${i}: repository(owner: "${owner}", name: "${name}") { primaryLanguage { name } }`;
      }).join('\n');

      const langMap = new Map<string, number>();

      try {
        const data = await graphql<Record<string, { primaryLanguage: { name: string } | null }>>(`
          query {
            ${aliasedQueries}
          }
        `);

        for (const key of Object.keys(data)) {
          const lang = data[key]?.primaryLanguage?.name;
          if (lang) {
            langMap.set(lang, (langMap.get(lang) ?? 0) + 1);
          }
        }
      } catch (err) {
        if (err instanceof GraphqlResponseError && err.data) {
          const data = err.data as Record<string, { primaryLanguage: { name: string } | null }>;
          for (const key of Object.keys(data)) {
            const lang = data[key]?.primaryLanguage?.name;
            if (lang) {
              langMap.set(lang, (langMap.get(lang) ?? 0) + 1);
            }
          }
        } else {
          throw err;
        }
      }

      return Array.from(langMap.entries())
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count);
    }

    // No date range — use all contributed-to repos
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
  });
}

// ---------------------------------------------------------------------------
// getRepoList  (for filter dropdown — repos contributed to in date range)
// ---------------------------------------------------------------------------

export async function getRepoList(from?: string, to?: string, org?: string): Promise<string[]> {
  const fromN = from ?? '';
  const toN = to ?? '';
  const orgN = org ?? '';
  const cacheKey = `repoListDropdown:${fromN}:${toN}:${orgN}`;

  return withCache(cacheKey, 15 * 60 * 1000, async () => {
    const reposWithCommits = await getCommitsByRepo(from, to, undefined, undefined, org);
    return reposWithCommits.map(r => r.repo);
  });
}

// ---------------------------------------------------------------------------
// getContributorList  (for contributor filter dropdown)
// ---------------------------------------------------------------------------

export async function getContributorList(org?: string, repo?: string): Promise<string[]> {
  const orgN = org ?? '';
  const repoN = repo ?? '';
  const cacheKey = `contributorList:${orgN}:${repoN}`;

  return withCache(cacheKey, 15 * 60 * 1000, async () => {
    // Helper: paginate all pages of a REST list call
    async function paginateLogins(fetcher: (page: number) => Promise<string[]>): Promise<string[]> {
      const all: string[] = [];
      let page = 1;
      while (true) {
        const batch = await fetcher(page);
        all.push(...batch);
        if (batch.length < 100) break;
        page++;
      }
      return all;
    }

    if (repo) {
      const [owner, repoName] = repo.split('/');
      try {
        const logins = await paginateLogins(async (page) => {
          const response = await octokit.repos.listContributors({ owner, repo: repoName, per_page: 100, page });
          return response.data.map(c => c.login).filter((l): l is string => l !== undefined);
        });
        return logins.sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    }

    async function fetchOrgMembers(o: string): Promise<string[]> {
      try {
        return await paginateLogins(async (page) => {
          const response = await octokit.orgs.listMembers({ org: o, per_page: 100, page });
          return response.data.map(m => m.login);
        });
      } catch {
        return [];
      }
    }

    if (org) {
      return (await fetchOrgMembers(org)).sort((a, b) => a.localeCompare(b));
    }

    // Unfiltered: fetch members from all of the user's orgs, merge and deduplicate
    const orgs = await getOrgList();
    if (orgs.length === 0) {
      return [USERNAME];
    }

    const results = await Promise.all(orgs.map(fetchOrgMembers));

    const loginSet = new Set<string>();
    for (const batch of results) {
      for (const login of batch) loginSet.add(login);
    }

    return Array.from(loginSet).sort((a, b) => a.localeCompare(b));
  });
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
