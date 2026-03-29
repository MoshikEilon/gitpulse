import { Router, Request, Response } from 'express';

export const syncRouter = Router();

// POST /api/sync/start — stub: live mode, no sync needed
syncRouter.post('/start', (_req: Request, res: Response) => {
  res.json({ synced: false, message: 'Live mode - no sync needed' });
});

// GET /api/sync/progress — stub: live mode, no sync state
syncRouter.get('/progress', (_req: Request, res: Response) => {
  res.json({ synced: false, message: 'Live mode - no sync needed', running: false });
});
