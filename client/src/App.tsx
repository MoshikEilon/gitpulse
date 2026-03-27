import { Routes, Route } from 'react-router-dom';
import { Nav } from './components/Nav.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { PRsPage } from './pages/PRs.tsx';
import { CommitsPage } from './pages/Commits.tsx';
import { ChatPage } from './pages/Chat.tsx';
import { ReposPage } from './pages/Repos.tsx';

export default function App() {
  return (
    <div className="app">
      <Nav />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/commits" element={<CommitsPage />} />
          <Route path="/prs" element={<PRsPage />} />
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  );
}
