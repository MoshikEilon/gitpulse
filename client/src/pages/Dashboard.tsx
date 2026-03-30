import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { api, Stats, MonthlyCommits, PRStats, DateRange, Filters } from '../lib/api.ts';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  return { from: toDateString(from), to: toDateString(to) };
}

function rangeLabel(range: DateRange): string {
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `from ${range.from}`;
  if (range.to) return `until ${range.to}`;
  return 'all time';
}

export function Dashboard() {
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [repo, setRepo] = useState('');
  const [author, setAuthor] = useState('');
  const [org, setOrg] = useState('');
  const [orgList, setOrgList] = useState<string[]>([]);
  const [repoList, setRepoList] = useState<string[]>([]);
  const [contributorList, setContributorList] = useState<string[]>([]);
  const [contributorLoading, setContributorLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyCommits[]>([]);
  const [prStats, setPrStats] = useState<PRStats | null>(null);
  const [languages, setLanguages] = useState<Array<{ language: string; repos: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [breakdownType, setBreakdownType] = useState<'commits' | 'reviews' | null>(null);
  const [breakdownData, setBreakdownData] = useState<Array<{ repo: string; value: number }>>([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  // Load org list on mount
  useEffect(() => {
    api.orgList().then(setOrgList).catch(() => {});
  }, []);

  // Load repo list and contributor list when org or repo changes
  useEffect(() => {
    api.repoList(range, org ? { org } : undefined).then(setRepoList).catch(() => {});
    setContributorLoading(true);
    api.contributorList(org || repo ? { org: org || undefined, repo: repo || undefined } : undefined)
      .then(list => { setContributorList(list); setContributorLoading(false); })
      .catch(() => setContributorLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, repo]);

  const fetchAll = useCallback((r: DateRange, currentRepo: string, currentAuthor: string, currentOrg: string) => {
    setLoading(true);
    setRefreshing(true);
    setLocLoading(true);

    const filters: Filters = {
      range: r,
      repo: currentRepo || undefined,
      author: currentAuthor || undefined,
      org: currentOrg || undefined,
    };

    // Fetch stats (includes linesAdded/linesDeleted), monthly, prStats in parallel
    // Stats may be slow due to LOC pagination — show partial data first
    const statsPromise = api.stats(filters).then(s => {
      setStats(s);
      setLocLoading(false);
      return s;
    }).catch(err => {
      console.error('[fetchAll] stats error:', err);
      setLocLoading(false);
      throw err;
    });

    Promise.all([
      statsPromise,
      api.commitsMonthly(filters).catch(err => { console.error('[fetchAll] commitsMonthly error:', err); return []; }),
      api.prStats(filters).catch(err => { console.error('[fetchAll] prStats error:', err); return null; }),
      api.languages(r).catch(err => { console.error('[fetchAll] languages error:', err); return []; }),
    ]).then(([, m, p, l]) => {
      setMonthly(m as typeof monthly);
      if (p) setPrStats(p as typeof prStats);
      setLanguages(l as typeof languages);
      setLoading(false);
      setRefreshing(false);
    }).catch(err => {
      console.error('[fetchAll] fatal error:', err);
      setLoading(false);
      setRefreshing(false);
      setLocLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchAll(range, repo, author, org);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRangeChange(field: 'from' | 'to', value: string) {
    const newRange = { ...range, [field]: value || undefined };
    setRange(newRange);
  }

  function handleApply() {
    fetchAll(range, repo, author, org);
    // Refresh repo list with updated range
    api.repoList(range, org ? { org } : undefined).then(setRepoList).catch(() => {});
  }

  function openBreakdown(type: 'commits' | 'reviews') {
    setBreakdownType(type);
    setBreakdownLoading(true);
    setBreakdownData([]);
    const filters: Filters = { range, repo: repo || undefined, author: author || undefined, org: org || undefined };
    if (type === 'commits') {
      api.commitsByRepo(filters).then(data => {
        setBreakdownData(data.map(d => ({ repo: d.repo, value: d.commits })));
        setBreakdownLoading(false);
      }).catch(() => setBreakdownLoading(false));
    } else {
      api.reviewsByRepo(filters).then(data => {
        setBreakdownData(data.map(d => ({ repo: d.repo, value: d.reviews })));
        setBreakdownLoading(false);
      }).catch(() => setBreakdownLoading(false));
    }
  }

  function closeBreakdown() {
    setBreakdownType(null);
  }

  if (loading && !stats) return <div className="loading">Loading your GitHub universe...</div>;

  const isEmpty = !stats || (stats.commits.count === 0 && stats.prs.count === 0 && stats.reviews.count === 0);

  if (isEmpty && !loading) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚀</div>
        <h2>No data yet</h2>
        <p>No contribution data found. Make sure your <strong>GITHUB_TOKEN</strong> is set and has the required scopes.</p>
        <p className="empty-sub">Data is fetched live from GitHub — no sync required.</p>
      </div>
    );
  }

  const label = rangeLabel(range);
  const orgLabel = org ? `org:${org}` : null;
  const filterLabel = repo ? repo.split('/').pop() : (author ? `@${author}` : null);
  const activeFilterLabel = [orgLabel, filterLabel].filter(Boolean).join(' · ') || null;

  const commitChartData = {
    labels: monthly.map(m => m.month),
    datasets: [{
      label: 'Commits',
      data: monthly.map(m => m.commits),
      backgroundColor: 'rgba(99, 102, 241, 0.7)',
      borderRadius: 4,
    }],
  };

  const prMonthly = prStats?.monthly ?? [];
  const prChartData = {
    labels: prMonthly.map(m => m.month),
    datasets: [
      { label: 'Opened', data: prMonthly.map(m => m.total), backgroundColor: 'rgba(99, 102, 241, 0.5)', borderRadius: 4 },
      { label: 'Merged', data: prMonthly.map(m => m.merged), backgroundColor: 'rgba(34, 197, 94, 0.7)', borderRadius: 4 },
    ],
  };

  const langData = languages.slice(0, 8);
  const langChartData = {
    labels: langData.map(l => l.language),
    datasets: [{
      data: langData.map(l => l.repos),
      backgroundColor: [
        '#6366f1','#22c55e','#f59e0b','#ec4899','#14b8a6',
        '#f97316','#8b5cf6','#06b6d4',
      ],
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } },
  };

  const linesAdded = stats?.linesAdded ?? 0;
  const linesDeleted = stats?.linesDeleted ?? 0;
  const netLines = linesAdded - linesDeleted;

  return (
    <div className="page">
      <div className="dashboard-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* Unified Filter Bar */}
      <div className="filter-bar">
        <label className="date-range-label">From</label>
        <input
          type="date"
          className="date-input"
          value={range.from ?? ''}
          onChange={e => handleRangeChange('from', e.target.value)}
        />
        <label className="date-range-label">To</label>
        <input
          type="date"
          className="date-input"
          value={range.to ?? ''}
          onChange={e => handleRangeChange('to', e.target.value)}
        />
        <div className="filter-divider" />
        {orgList.length > 0 && (
          <select
            className="filter-select filter-select--dashboard filter-select--org"
            value={org}
            onChange={e => {
              const newOrg = e.target.value;
              setOrg(newOrg);
              setRepo('');
              setAuthor('');
            }}
          >
            <option value="">All orgs</option>
            {orgList.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
        <input
          list="repo-list"
          className="filter-select filter-select--dashboard"
          value={repo}
          placeholder="All repos"
          onChange={e => {
            setRepo(e.target.value);
            setAuthor('');
          }}
        />
        <datalist id="repo-list">
          {repoList.map(r => <option key={r} value={r} />)}
        </datalist>
        <input
          list="contributor-list"
          className="filter-select filter-select--dashboard"
          value={author}
          placeholder={contributorLoading ? 'Loading...' : 'All contributors'}
          disabled={contributorLoading}
          onChange={e => setAuthor(e.target.value)}
        />
        <datalist id="contributor-list">
          {contributorList.map(c => <option key={c} value={c} />)}
        </datalist>
        <button className="btn btn-primary date-apply-btn" onClick={handleApply} disabled={refreshing}>
          {refreshing ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {refreshing && <div className="refresh-banner">Fetching data…</div>}

      {/* Stat cards */}
      <div className={`stat-grid${refreshing ? ' refreshing' : ''}`}>
        <StatCard label="Total Commits" value={stats?.commits.count.toLocaleString() ?? '—'} icon="💻" color="indigo" sub={activeFilterLabel ? `${label} · ${activeFilterLabel}` : label} clickable onClick={() => openBreakdown('commits')} />
        <StatCard label="Pull Requests" value={stats?.prs.count.toLocaleString() ?? '—'} icon="🔀" color="violet" sub={`${stats?.prs.merged ?? 0} merged · ${stats?.prs.open ?? 0} open${activeFilterLabel ? ` · ${activeFilterLabel}` : ''}`} />
        <StatCard label="PR Reviews" value={stats?.reviews.count.toLocaleString() ?? '—'} icon="👀" color="emerald" sub={activeFilterLabel ? `${label} · ${activeFilterLabel}` : label} clickable onClick={() => openBreakdown('reviews')} />
        <StatCard label="Issues" value={stats?.issues.count.toLocaleString() ?? '—'} icon="🐛" color="amber" sub={`${stats?.issues.open ?? 0} open`} />
        <StatCard label="Repositories" value={stats?.repos.total.toLocaleString() ?? '—'} icon="📦" color="sky" sub="your repos" />
        <StatCard
          label="Merge Rate"
          value={stats?.mergeRate != null ? `${stats.mergeRate}%` : prStats?.mergeRate ? `${prStats.mergeRate.merge_rate}%` : 'N/A'}
          icon="✅"
          color="green"
          sub="PRs merged"
        />
        <StatCard
          label="Lines of Code"
          value={locLoading ? '…' : `${netLines >= 0 ? '+' : ''}${netLines.toLocaleString()}`}
          icon="📝"
          color="rose"
          sub={locLoading ? 'Calculating...' : `+${linesAdded.toLocaleString()} / -${linesDeleted.toLocaleString()}`}
        />
      </div>

      {/* Charts */}
      <div className={`chart-grid${refreshing ? ' refreshing' : ''}`}>
        <div className="chart-card">
          <h3>Commits per Month</h3>
          <div className="chart-wrap">
            <Bar data={commitChartData} options={chartOptions} />
          </div>
        </div>

        <div className="chart-card">
          <h3>Pull Requests per Month</h3>
          <div className="chart-wrap">
            <Bar data={prChartData} options={{ ...chartOptions, plugins: { legend: { display: true, labels: { color: '#9ca3af' } } } }} />
          </div>
        </div>

        {langData.length > 0 && (
          <div className="chart-card chart-card--small">
            <h3>Languages</h3>
            <div className="chart-wrap chart-wrap--doughnut">
              <Doughnut data={langChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12 } } } }} />
            </div>
          </div>
        )}

        {prStats && prStats.byRepo.length > 0 && (
          <div className="chart-card chart-card--small">
            <h3>Top Repos by PRs</h3>
            <div className="top-list">
              {prStats.byRepo.slice(0, 8).map(r => (
                <div key={r.repo_full_name} className="top-list-item">
                  <span className="top-list-label">{r.repo_full_name.split('/').pop()}</span>
                  <div className="top-list-bar-wrap">
                    <div className="top-list-bar" style={{ width: `${(r.total / prStats.byRepo[0].total) * 100}%` }} />
                  </div>
                  <span className="top-list-value">{r.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Breakdown Modal */}
      {breakdownType && (
        <BreakdownModal
          title={breakdownType === 'commits' ? 'Commits by Repo' : 'Reviews by Repo'}
          data={breakdownData}
          loading={breakdownLoading}
          onClose={closeBreakdown}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color, sub, clickable, onClick }: { label: string; value: string; icon: string; color: string; sub?: string; clickable?: boolean; onClick?: () => void }) {
  return (
    <div className={`stat-card stat-card--${color}${clickable ? ' stat-card--clickable' : ''}`} onClick={onClick}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function BreakdownModal({ title, data, loading, onClose }: { title: string; data: Array<{ repo: string; value: number }>; loading: boolean; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  const max = data.length > 0 ? data[0].value : 1;

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : data.length === 0 ? (
            <div style={{ color: 'var(--text2)', textAlign: 'center', padding: '20px' }}>No data found for this range.</div>
          ) : (
            <div className="top-list">
              {data.map(item => (
                <div key={item.repo} className="top-list-item">
                  <span className="top-list-label" style={{ width: 200 }} title={item.repo}>{item.repo.split('/').pop()}</span>
                  <div className="top-list-bar-wrap">
                    <div className="top-list-bar" style={{ width: `${(item.value / max) * 100}%` }} />
                  </div>
                  <span className="top-list-value" style={{ width: 40 }}>{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
