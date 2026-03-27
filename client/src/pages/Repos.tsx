import { useEffect, useState } from 'react';
import { api, Repo } from '../lib/api.ts';

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Python: '#3572a5',
  Go: '#00add8', Rust: '#dea584', Java: '#b07219', 'C#': '#178600',
  Ruby: '#701516', PHP: '#4f5d95', Swift: '#f05138', Kotlin: '#a97bff',
  CSS: '#563d7c', HTML: '#e34c26', Shell: '#89e051',
};

export function ReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [orgs, setOrgs] = useState<Array<{ org_name: string; repo_count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [orgFilter, setOrgFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([api.repos({ limit: 300 }), api.orgs()])
      .then(([r, o]) => { setRepos(r); setOrgs(o); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = repos.filter(r => {
    if (orgFilter && r.org_name !== orgFilter) return false;
    if (search && !r.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page">
      <h1 className="page-title">Repositories</h1>

      {orgs.length > 0 && (
        <div className="org-chips">
          <button className={`org-chip ${orgFilter === '' ? 'active' : ''}`} onClick={() => setOrgFilter('')}>All ({repos.length})</button>
          <button className={`org-chip ${orgFilter === '__personal' ? 'active' : ''}`} onClick={() => setOrgFilter('__personal')}>Personal</button>
          {orgs.map(o => (
            <button key={o.org_name} className={`org-chip ${orgFilter === o.org_name ? 'active' : ''}`} onClick={() => setOrgFilter(o.org_name)}>
              {o.org_name} ({o.repo_count})
            </button>
          ))}
        </div>
      )}

      <div className="filters">
        <input className="search-input" placeholder="Search repos…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="loading">Loading repos…</div>
      ) : (
        <div className="repo-grid">
          {filtered.map(r => (
            <a key={r.id} href={r.html_url} target="_blank" rel="noopener" className="repo-card">
              <div className="repo-header">
                <span className="repo-name">{r.name}</span>
                {r.is_private && <span className="repo-private">private</span>}
              </div>
              <div className="repo-owner">{r.owner}</div>
              <div className="repo-footer">
                {r.language && (
                  <span className="repo-lang">
                    <span className="lang-dot" style={{ backgroundColor: LANG_COLORS[r.language] ?? '#9ca3af' }} />
                    {r.language}
                  </span>
                )}
                {r.stars > 0 && <span className="repo-stars">⭐ {r.stars}</span>}
                {r.forks > 0 && <span className="repo-forks">🍴 {r.forks}</span>}
              </div>
            </a>
          ))}
          {filtered.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No repos found</p></div>}
        </div>
      )}
    </div>
  );
}
