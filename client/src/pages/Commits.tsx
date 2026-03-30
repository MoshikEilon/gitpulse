import { useEffect, useState } from 'react';
import { api, Commit, HeatmapDay } from '../lib/api.ts';

function Heatmap({ data }: { data: HeatmapDay[] }) {
  const map = new Map(data.map(d => [d.date, d.count]));
  const max = Math.max(...data.map(d => d.count), 1);

  // Build last 52 weeks of dates
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 363);

  const days: string[] = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split('T')[0]);
  }

  const weeks: string[][] = [];
  let week: string[] = [];
  // Pad to start on Sunday
  const firstDay = new Date(days[0]).getDay();
  for (let i = 0; i < firstDay; i++) week.push('');
  for (const day of days) {
    week.push(day);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push(week);

  const getColor = (date: string) => {
    if (!date) return 'transparent';
    const count = map.get(date) ?? 0;
    if (count === 0) return '#1f2937';
    const intensity = Math.min(count / max, 1);
    if (intensity < 0.25) return '#3730a3';
    if (intensity < 0.5) return '#4f46e5';
    if (intensity < 0.75) return '#6366f1';
    return '#818cf8';
  };

  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {weeks.map((week, wi) => (
          <div key={wi} className="heatmap-col">
            {week.map((day, di) => (
              <div
                key={di}
                className="heatmap-cell"
                style={{ backgroundColor: getColor(day) }}
                title={day ? `${day}: ${map.get(day) ?? 0} commits` : ''}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        {['#1f2937','#3730a3','#4f46e5','#6366f1','#818cf8'].map(c => (
          <div key={c} className="heatmap-cell" style={{ backgroundColor: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export function CommitsPage() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [repoFilter, setRepoFilter] = useState('');

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    Promise.all([
      api.commits({ limit: 200 }),
      api.commitsHeatmap({ from, to }),
    ]).then(([c, h]) => {
      setCommits(c);
      setHeatmap(h);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const repos = [...new Set(commits.map(c => c.repo_full_name))].sort();

  const filtered = commits.filter(c => {
    if (repoFilter && c.repo_full_name !== repoFilter) return false;
    if (search && !c.message.toLowerCase().includes(search.toLowerCase()) && !c.repo_full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page">
      <h1 className="page-title">Commits</h1>

      {heatmap.length > 0 && (
        <div className="card">
          <h3>Contribution Activity</h3>
          <Heatmap data={heatmap} />
        </div>
      )}

      <div className="filters">
        <input
          className="search-input"
          placeholder="Search commits…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={repoFilter} onChange={e => setRepoFilter(e.target.value)}>
          <option value="">All repos</option>
          {repos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading commits…</div>
      ) : (
        <div className="commit-list">
          {filtered.map(c => {
            const commitCount = parseInt(c.message.match(/^(\d+)/)?.[1] ?? '1', 10);
            return (
              <div key={c.sha} className="commit-item">
                <span className="commit-sha">
                  <a href={c.url} target="_blank" rel="noopener" title={`View ${c.repo_full_name}`}>
                    {commitCount > 1 ? `+${commitCount}` : '●'}
                  </a>
                </span>
                <div className="commit-body">
                  <span className="commit-msg">
                    <a href={c.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>
                      {c.repo_full_name}
                    </a>
                  </span>
                  <div className="commit-meta">
                    <span className="commit-repo">{commitCount} commit{commitCount !== 1 ? 's' : ''}</span>
                    <span className="commit-date">{c.committed_at?.split('T')[0]}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="empty-state"><p>No commits found</p></div>}
        </div>
      )}
    </div>
  );
}
