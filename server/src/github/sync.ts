import { octokit, USERNAME } from './client.js';
import { db, setSyncState, getSyncState } from '../db/index.js';

let syncProgress = {
  running: false,
  phase: '',
  current: 0,
  total: 0,
  log: [] as string[],
  startedAt: null as string | null,
  completedAt: null as string | null,
};

function log(msg: string) {
  console.log(`[sync] ${msg}`);
  syncProgress.log.push(`${new Date().toISOString()}: ${msg}`);
  if (syncProgress.log.length > 200) syncProgress.log = syncProgress.log.slice(-200);
}

export function getSyncProgress() {
  return { ...syncProgress };
}

async function getAllRepos(): Promise<Array<{ id: number; full_name: string; name: string; owner: string; is_org: boolean; org_name?: string; description?: string; language?: string; stars: number; forks: number; is_private: boolean; html_url: string; default_branch: string; created_at: string; updated_at: string }>> {
  const repos: Array<{ id: number; full_name: string; name: string; owner: string; is_org: boolean; org_name?: string; description?: string; language?: string; stars: number; forks: number; is_private: boolean; html_url: string; default_branch: string; created_at: string; updated_at: string }> = [];

  // Personal repos
  log('Fetching personal repos...');
  for await (const response of octokit.paginate.iterator(octokit.repos.listForAuthenticatedUser, {
    visibility: 'all',
    affiliation: 'owner,collaborator',
    per_page: 100,
    sort: 'updated',
  })) {
    for (const r of response.data) {
      repos.push({
        id: r.id,
        full_name: r.full_name,
        name: r.name,
        owner: r.owner?.login ?? USERNAME,
        is_org: r.owner?.type === 'Organization',
        org_name: r.owner?.type === 'Organization' ? r.owner.login : undefined,
        description: r.description ?? undefined,
        language: r.language ?? undefined,
        stars: r.stargazers_count ?? 0,
        forks: r.forks_count ?? 0,
        is_private: r.private,
        html_url: r.html_url,
        default_branch: r.default_branch ?? 'main',
        created_at: r.created_at ?? new Date().toISOString(),
        updated_at: r.updated_at ?? new Date().toISOString(),
      });
    }
  }
  log(`Found ${repos.length} personal/collaborator repos`);

  // Org repos — list orgs first
  try {
    const orgsResp = await octokit.orgs.listForAuthenticatedUser({ per_page: 100 });
    const orgs = orgsResp.data.map((o: { login: string }) => o.login);
    log(`Found orgs: ${orgs.join(', ') || '(none)'}`);

    for (const org of orgs) {
      try {
        for await (const response of octokit.paginate.iterator(octokit.repos.listForOrg, {
          org,
          type: 'all',
          per_page: 100,
        })) {
          for (const r of response.data) {
            if (!repos.find(x => x.full_name === r.full_name)) {
              repos.push({
                id: r.id,
                full_name: r.full_name,
                name: r.name,
                owner: org,
                is_org: true,
                org_name: org,
                description: r.description ?? undefined,
                language: r.language ?? undefined,
                stars: r.stargazers_count ?? 0,
                forks: r.forks_count ?? 0,
                is_private: r.private,
                html_url: r.html_url,
                default_branch: r.default_branch ?? 'main',
                created_at: r.created_at ?? new Date().toISOString(),
                updated_at: r.updated_at ?? new Date().toISOString(),
              });
            }
          }
        }
        log(`Fetched repos for org: ${org}`);
      } catch (e) {
        log(`Skipping org ${org}: ${e}`);
      }
    }
  } catch (e) {
    log(`Could not list orgs: ${e}`);
  }

  return repos;
}

async function syncCommits(repoFullName: string) {
  try {
    const [owner, repo] = repoFullName.split('/');
    let count = 0;
    for await (const response of octokit.paginate.iterator(octokit.repos.listCommits, {
      owner,
      repo,
      author: USERNAME,
      per_page: 100,
    })) {
      const insertCommit = db.prepare(`
        INSERT OR IGNORE INTO commits (sha, repo_full_name, message, author_name, author_email, committed_at, url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const commit of response.data) {
        insertCommit.run(
          commit.sha,
          repoFullName,
          commit.commit.message,
          commit.commit.author?.name ?? '',
          commit.commit.author?.email ?? '',
          commit.commit.author?.date ?? null,
          commit.html_url,
        );
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function syncPRs(repoFullName: string) {
  try {
    const [owner, repo] = repoFullName.split('/');
    let count = 0;

    // PRs created by user
    for await (const response of octokit.paginate.iterator(octokit.pulls.list, {
      owner,
      repo,
      state: 'all',
      per_page: 100,
    })) {
      const insertPR = db.prepare(`
        INSERT OR REPLACE INTO pull_requests (
          id, repo_full_name, number, title, body, state, merged, draft,
          created_at, updated_at, merged_at, closed_at,
          additions, deletions, changed_files, comments, review_comments, commits,
          labels, base_branch, html_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const pr of response.data) {
        if (pr.user?.login !== USERNAME) continue;
        insertPR.run(
          pr.id, repoFullName, pr.number, pr.title, pr.body ?? '',
          pr.state, pr.merged_at ? 1 : 0, pr.draft ? 1 : 0,
          pr.created_at, pr.updated_at, pr.merged_at ?? null, pr.closed_at ?? null,
          0, 0, 0, 0, 0, 0,
          JSON.stringify(pr.labels?.map((l) => typeof l === 'string' ? l : l.name) ?? []),
          pr.base?.ref ?? '',
          pr.html_url,
        );
        count++;
      }
    }

    // Reviews by user across all PRs (recent)
    const reviewInsert = db.prepare(`
      INSERT OR IGNORE INTO pr_reviews (id, repo_full_name, pr_number, state, body, submitted_at, html_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for await (const prResp of octokit.paginate.iterator(octokit.pulls.list, {
        owner,
        repo,
        state: 'all',
        per_page: 50,
      })) {
        for (const pr of prResp.data) {
          try {
            const reviews = await octokit.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 100 });
            for (const review of reviews.data) {
              if (review.user?.login !== USERNAME) continue;
              reviewInsert.run(
                review.id, repoFullName, pr.number,
                review.state, review.body ?? '',
                review.submitted_at ?? null,
                review.html_url,
              );
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    return count;
  } catch {
    return 0;
  }
}

async function syncIssues(repoFullName: string) {
  try {
    const [owner, repo] = repoFullName.split('/');
    let count = 0;
    for await (const response of octokit.paginate.iterator(octokit.issues.listForRepo, {
      owner,
      repo,
      creator: USERNAME,
      state: 'all',
      per_page: 100,
    })) {
      const insertIssue = db.prepare(`
        INSERT OR REPLACE INTO issues (id, repo_full_name, number, title, body, state, created_at, updated_at, closed_at, labels, comments, html_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const issue of response.data) {
        if (issue.pull_request) continue; // skip PRs listed as issues
        insertIssue.run(
          issue.id, repoFullName, issue.number, issue.title, issue.body ?? '',
          issue.state, issue.created_at, issue.updated_at, issue.closed_at ?? null,
          JSON.stringify(issue.labels?.map((l) => typeof l === 'string' ? l : l.name) ?? []),
          issue.comments,
          issue.html_url,
        );
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function runFullSync() {
  if (syncProgress.running) {
    log('Sync already running');
    return;
  }

  syncProgress = { running: true, phase: 'starting', current: 0, total: 0, log: [], startedAt: new Date().toISOString(), completedAt: null };
  log('=== Starting full sync ===');

  try {
    // 1. Fetch all repos
    syncProgress.phase = 'repos';
    const repos = await getAllRepos();
    syncProgress.total = repos.length;

    // Insert repos into DB
    const insertRepo = db.prepare(`
      INSERT OR REPLACE INTO repositories (id, name, full_name, owner, is_org, org_name, description, language, stars, forks, is_private, html_url, default_branch, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of repos) {
      insertRepo.run(
        r.id, r.name, r.full_name, r.owner, r.is_org ? 1 : 0, r.org_name ?? null,
        r.description ?? null, r.language ?? null, r.stars, r.forks, r.is_private ? 1 : 0,
        r.html_url, r.default_branch, r.created_at, r.updated_at,
      );
    }
    log(`Saved ${repos.length} repos to DB`);

    // 2. Sync commits, PRs, issues for each repo
    syncProgress.phase = 'data';
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      syncProgress.current = i + 1;
      log(`[${i + 1}/${repos.length}] Syncing ${repo.full_name}`);

      const [commits, prs] = await Promise.all([
        syncCommits(repo.full_name),
        syncPRs(repo.full_name),
      ]);
      await syncIssues(repo.full_name);

      log(`  commits=${commits} prs=${prs}`);
    }

    setSyncState('last_sync', new Date().toISOString());
    syncProgress.completedAt = new Date().toISOString();
    syncProgress.phase = 'done';
    log('=== Sync complete ===');
  } catch (err) {
    log(`Sync error: ${err}`);
    syncProgress.phase = 'error';
  } finally {
    syncProgress.running = false;
  }
}
