import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { contributionsRouter } from './api/contributions.js';
import { chatRouter } from './api/chat.js';
import { syncRouter } from './api/sync.js';
import { clearCache } from './github/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'] }));
app.use(express.json({ limit: '5mb' }));

// API routes
app.use('/api/contributions', contributionsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/sync', syncRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Cache management
app.post('/api/cache/clear', (_req, res) => {
  clearCache();
  res.json({ ok: true, message: 'Cache cleared' });
});

// Serve frontend in production
const distPath = path.join(__dirname, '../../client/dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GitPulse server running at http://localhost:${PORT}`);
});
