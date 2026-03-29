import { NavLink } from 'react-router-dom';

export function Nav() {
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
      <div className="nav-live">
        <span className="live-badge">● Live</span>
      </div>
    </nav>
  );
}
