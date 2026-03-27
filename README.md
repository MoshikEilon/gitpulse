# ⚡ GitPulse

> Your GitHub contribution universe — commits, PRs, reviews, and insights across all repos with AI-powered chat.

## Features

- **Dashboard** — Contribution stats, commit activity charts, PR merge rates, language breakdown
- **Commits** — Full commit history with heatmap calendar, searchable and filterable by repo
- **Pull Requests** — All PRs across every repo with filter by state (open/merged/closed), merge rate analysis
- **Repos** — Browse all personal and org repos with language and star counts
- **AI Chat** — Ask Claude anything about your contribution history in natural language

## Setup

### 1. Configure environment

Edit `server/.env`:

```env
GITHUB_TOKEN=your_github_token_here
GITHUB_USERNAME=YourGitHubUsername
ANTHROPIC_API_KEY=your_anthropic_api_key_here
PORT=3001
```

### 2. Install dependencies

```bash
npm install --workspace=server
npm install --workspace=client
```

### 3. Start development servers

```bash
# Terminal 1 — API server
cd server && npx tsx src/index.ts

# Terminal 2 — Frontend
cd client && npx vite
```

Open [http://localhost:5173](http://localhost:5173) and click **Sync Now** to fetch your GitHub data.

## Architecture

```
gitpulse/
├── server/          # Express + TypeScript API
│   └── src/
│       ├── db/      # SQLite schema & helpers
│       ├── github/  # Octokit sync (commits, PRs, reviews, issues)
│       ├── claude/  # Claude API chat with contribution context
│       └── api/     # REST endpoints
└── client/          # React + Vite frontend
    └── src/
        ├── pages/   # Dashboard, Commits, PRs, Repos, Chat
        ├── components/
        └── lib/     # API client
```

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, SQLite (better-sqlite3), Octokit, Anthropic SDK
- **Frontend**: React, Vite, TypeScript, Chart.js, React Router
