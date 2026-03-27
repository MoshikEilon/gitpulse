import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function getContributionContext(): string {
  // Gather summary stats for context
  const repos = db.prepare('SELECT COUNT(*) as count FROM repositories').get() as { count: number };
  const commits = db.prepare('SELECT COUNT(*) as count, MIN(committed_at) as earliest FROM commits').get() as { count: number; earliest: string };
  const prs = db.prepare('SELECT COUNT(*) as count, SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged FROM pull_requests').get() as { count: number; merged: number };
  const reviews = db.prepare('SELECT COUNT(*) as count FROM pr_reviews').get() as { count: number };
  const issues = db.prepare('SELECT COUNT(*) as count FROM issues').get() as { count: number };

  // Top repos by commits
  const topReposByCommits = db.prepare(`
    SELECT repo_full_name, COUNT(*) as commits FROM commits
    GROUP BY repo_full_name ORDER BY commits DESC LIMIT 10
  `).all() as Array<{ repo_full_name: string; commits: number }>;

  // Monthly commit activity (last 12 months)
  const monthlyActivity = db.prepare(`
    SELECT strftime('%Y-%m', committed_at) as month, COUNT(*) as commits
    FROM commits WHERE committed_at > datetime('now', '-12 months')
    GROUP BY month ORDER BY month
  `).all() as Array<{ month: string; commits: number }>;

  // PR stats by repo
  const topReposByPRs = db.prepare(`
    SELECT repo_full_name, COUNT(*) as prs, SUM(CASE WHEN merged=1 THEN 1 ELSE 0 END) as merged
    FROM pull_requests GROUP BY repo_full_name ORDER BY prs DESC LIMIT 10
  `).all() as Array<{ repo_full_name: string; prs: number; merged: number }>;

  // Languages
  const languages = db.prepare(`
    SELECT language, COUNT(*) as count FROM repositories
    WHERE language IS NOT NULL GROUP BY language ORDER BY count DESC LIMIT 10
  `).all() as Array<{ language: string; count: number }>;

  // Recent PRs
  const recentPRs = db.prepare(`
    SELECT repo_full_name, number, title, state, merged, created_at, html_url
    FROM pull_requests ORDER BY created_at DESC LIMIT 20
  `).all() as Array<{ repo_full_name: string; number: number; title: string; state: string; merged: number; created_at: string; html_url: string }>;

  return `
You are GitPulse AI — an assistant with full access to the user's GitHub contribution data.
The user is ${process.env.GITHUB_USERNAME || 'MoshikEilon'}.

## Summary Statistics
- Total repos tracked: ${repos.count}
- Total commits: ${commits.count} (earliest: ${commits.earliest || 'N/A'})
- Total PRs created: ${prs.count} (merged: ${prs.merged})
- Total PR reviews given: ${reviews.count}
- Total issues created: ${issues.count}

## Top Repos by Commits
${topReposByCommits.map(r => `- ${r.repo_full_name}: ${r.commits} commits`).join('\n')}

## Top Repos by PRs
${topReposByPRs.map(r => `- ${r.repo_full_name}: ${r.prs} PRs (${r.merged} merged)`).join('\n')}

## Monthly Activity (last 12 months)
${monthlyActivity.map(m => `- ${m.month}: ${m.commits} commits`).join('\n')}

## Languages
${languages.map(l => `- ${l.language}: ${l.count} repos`).join('\n')}

## Recent PRs
${recentPRs.map(p => `- [${p.state}${p.merged ? '/merged' : ''}] ${p.repo_full_name}#${p.number}: ${p.title} (${p.created_at?.split('T')[0]})`).join('\n')}

Answer questions about the user's contributions, code activity, patterns, and insights.
Be specific and use the data above. For questions needing more detail, explain what data is available.
`.trim();
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  const systemPrompt = getContributionContext();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  const block = response.content[0];
  if (block.type === 'text') return block.text;
  return 'No response generated.';
}

export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
  const systemPrompt = getContributionContext();

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}
