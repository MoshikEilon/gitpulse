import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, SyncProgress } from '../lib/api.ts';

export function Nav() {
  const [sync, setSync] = useState<SyncProgress | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const p = await api.syncProgress();
        setSync(p);
        setSyncing(p.running);
        if (!p.running) clearInterval(interval);
      } catch { /* ignore */ }
    };
    poll();
    interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  const startSync = async () => {
    setSyncing(true);
    try {
      await api.syncStart();
      // Start polling
      const poll = setInterval(async () => {
        const p = await api.syncProgress();
        setSync(p);
        if (!p.running) clearInterval(poll);
      }, 2000);
    } catch (e) {
      alert('Sync failed: ' + e);
      setSyncing(false);
    }
  };

  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="nav-logo">⚡</span>
        <span className="nav-title">GitPulse</span>
      </div>
      <div className="nav-links">
        <NavLink to="/" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Dashboard</NavLink>
        <NavLink to="/commits" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Commits</NavLink>
        <NavLink to="/prs" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Pull Requests</NavLink>
        <NavLink to="/repos" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Repos</NavLink>
        <NavLink to="/chat" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>AI Chat</NavLink>
      </div>
      <div className="nav-sync">
        {sync?.lastSync && !syncing && (
          <span className="sync-time">Synced {new Date(sync.lastSync).toLocaleDateString()}</span>
        )}
        {syncing && (
          <span className="sync-badge">
            <span className="spin">⟳</span> Syncing {sync?.current}/{sync?.total} repos…
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={startSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>
    </nav>
  );
}
