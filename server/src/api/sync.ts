import { Router, Request, Response } from 'express';
import { runFullSync, getSyncProgress } from '../github/sync.js';
import { getSyncState } from '../db/index.js';

export const syncRouter = Router();

// POST /api/sync/start — kick off a full sync
syncRouter.post('/start', (_req: Request, res: Response) => {
  const progress = getSyncProgress();
  if (progress.running) {
    res.status(409).json({ error: 'Sync already running', progress });
    return;
  }
  // Run in background, don't await
  runFullSync().catch(console.error);
  res.json({ started: true });
});

// GET /api/sync/progress — get current sync status
syncRouter.get('/progress', (_req: Request, res: Response) => {
  const progress = getSyncProgress();
  const lastSync = getSyncState('last_sync');
  res.json({ ...progress, lastSync });
});
