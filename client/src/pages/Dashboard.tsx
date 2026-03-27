import { useEffect, useState } from 'react';
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
import { api, Stats, MonthlyCommits, PRStats } from '../lib/api.ts';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyCommits[]>([]);
  const [prStats, setPrStats] = useState<PRStats | null>(null);
  const [languages, setLanguages] = useState<Array<{ language: string; repos: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.stats(),
      api.commitsMonthly(),
      api.prStats(),
      api.languages(),
    ]).then(([s, m, p, l]) => {
      setStats(s);
      setMonthly(m);
      setPrStats(p);
      setLanguages(l);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading your GitHub universe...</div>;

  const isEmpty = !stats || stats.commits.count === 0;

  if (isEmpty) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚀</div>
        <h2>No data yet</h2>
        <p>Click <strong>Sync Now</strong> in the top-right to fetch all your GitHub contributions.</p>
        <p className="empty-sub">This may take a few minutes depending on how many repos you have.</p>
      </div>
    );
  }

  const last12 = monthly.slice(-12);

  const commitChartData = {
    labels: last12.map(m => m.month),
    datasets: [{
      label: 'Commits',
      data: last12.map(m => m.commits),
      backgroundColor: 'rgba(99, 102, 241, 0.7)',
      borderRadius: 4,
    }],
  };

  const prMonthly = prStats?.monthly.slice(-12) ?? [];
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

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>

      {/* Stat cards */}
      <div className="stat-grid">
        <StatCard label="Total Commits" value={stats!.commits.count.toLocaleString()} icon="💻" color="indigo" sub={`Since ${stats!.commits.earliest?.split('T')[0] ?? 'N/A'}`} />
        <StatCard label="Pull Requests" value={stats!.prs.count.toLocaleString()} icon="🔀" color="violet" sub={`${stats!.prs.merged} merged · ${stats!.prs.open} open`} />
        <StatCard label="PR Reviews" value={stats!.reviews.count.toLocaleString()} icon="👀" color="emerald" sub="Reviews given" />
        <StatCard label="Issues" value={stats!.issues.count.toLocaleString()} icon="🐛" color="amber" sub={`${stats!.issues.open} open`} />
        <StatCard label="Repositories" value={stats!.repos.total.toLocaleString()} icon="📦" color="sky" sub={`${stats!.repos.orgs} org repos`} />
        <StatCard label="Merge Rate" value={prStats?.mergeRate ? `${prStats.mergeRate.merge_rate}%` : 'N/A'} icon="✅" color="green" sub="PRs merged" />
      </div>

      {/* Charts */}
      <div className="chart-grid">
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
    </div>
  );
}

function StatCard({ label, value, icon, color, sub }: { label: string; value: string; icon: string; color: string; sub?: string }) {
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
