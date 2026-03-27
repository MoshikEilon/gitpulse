import { useEffect, useState } from 'react';
import { api, PR } from '../lib/api.ts';

const STATE_COLORS: Record<string, string> = {
  open: '#22c55e',
  closed: '#ef4444',
};

export function PRsPage() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'merged'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.prs({ limit: 200 }).then(data => { setPrs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = prs.filter(pr => {
    if (filter === 'merged' && !pr.merged) return false;
    if (filter === 'open' && pr.state !== 'open') return false;
    if (filter === 'closed' && pr.state !== 'closed') return false;
    if (search && !pr.title.toLowerCase().includes(search.toLowerCase()) && !pr.repo_full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const total = prs.length;
  const merged = prs.filter(p => p.merged).length;
  const open = prs.filter(p => p.state === 'open').length;

  return (
    <div className="page">
      <h1 className="page-title">Pull Requests</h1>

      <div className="mini-stats">
        <span>Total: <strong>{total}</strong></span>
        <span>Merged: <strong className="green">{merged}</strong></span>
        <span>Open: <strong className="emerald">{open}</strong></span>
        <span>Merge rate: <strong>{total > 0 ? Math.round((merged / (total - open)) * 100) : 0}%</strong></span>
      </div>

      <div className="filters">
        <div className="filter-tabs">
          {(['all', 'open', 'merged', 'closed'] as const).map(f => (
            <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          placeholder="Search by title or repo…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Loading pull requests…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🔀</div><p>No PRs found</p></div>
      ) : (
        <div className="pr-list">
          {filtered.map(pr => (
            <div key={pr.id} className="pr-item">
              <div className="pr-status">
                <span className="pr-badge" style={{ backgroundColor: pr.merged ? '#7c3aed' : STATE_COLORS[pr.state] || '#6b7280' }}>
                  {pr.merged ? 'merged' : pr.state}
                </span>
              </div>
              <div className="pr-body">
                <a href={pr.html_url} target="_blank" rel="noopener" className="pr-title">{pr.title}</a>
                <div className="pr-meta">
                  <span className="pr-repo">{pr.repo_full_name}</span>
                  <span className="pr-num">#{pr.number}</span>
                  <span className="pr-date">{pr.created_at?.split('T')[0]}</span>
                  {pr.additions > 0 && <span className="pr-adds">+{pr.additions}</span>}
                  {pr.deletions > 0 && <span className="pr-dels">-{pr.deletions}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
