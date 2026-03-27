const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface Stats {
  repos: { total: number; orgs: number };
  commits: { count: number; earliest: string; latest: string };
  prs: { count: number; merged: number; open: number };
  reviews: { count: number };
  issues: { count: number; open: number };
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  is_org: boolean;
  is_private: boolean;
  org_name?: string;
  language?: string;
  stars: number;
  forks: number;
  html_url: string;
}

export interface Commit {
  sha: string;
  repo_full_name: string;
  message: string;
  committed_at: string;
  url: string;
}

export interface PR {
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

export interface PRStats {
  monthly: Array<{ month: string; total: number; merged: number; open: number }>;
  byRepo: Array<{ repo_full_name: string; total: number; merged: number }>;
  mergeRate: { total: number; merged: number; merge_rate: number };
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface MonthlyCommits {
  month: string;
  commits: number;
  repos: number;
}

export interface SyncProgress {
  running: boolean;
  phase: string;
  current: number;
  total: number;
  log: string[];
  startedAt?: string;
  completedAt?: string;
  lastSync?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const api = {
  stats: () => get<Stats>('/contributions/stats'),
  repos: (params?: Record<string, string | number>) => get<Repo[]>('/contributions/repos', params),
  commits: (params?: Record<string, string | number>) => get<Commit[]>('/contributions/commits', params),
  commitsHeatmap: (months = 12) => get<HeatmapDay[]>('/contributions/commits/heatmap', { months }),
  commitsMonthly: () => get<MonthlyCommits[]>('/contributions/commits/monthly'),
  prs: (params?: Record<string, string | number>) => get<PR[]>('/contributions/prs', params),
  prStats: () => get<PRStats>('/contributions/prs/stats'),
  orgs: () => get<Array<{ org_name: string; repo_count: number }>>('/contributions/orgs'),
  languages: () => get<Array<{ language: string; repos: number }>>('/contributions/languages'),

  syncStart: () => post<{ started: boolean }>('/sync/start', {}),
  syncProgress: () => get<SyncProgress>('/sync/progress'),

  chat: (messages: ChatMessage[]) => post<{ reply: string }>('/chat', { messages }),

  async *chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
    const res = await fetch(BASE + '/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok || !res.body) throw new Error('Stream failed');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as { text?: string; error?: string };
          if (parsed.text) yield parsed.text;
        } catch { /* ignore */ }
      }
    }
  },
};
