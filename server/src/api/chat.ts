import { Router, Request, Response } from 'express';
import { chat, chatStream, ChatMessage } from '../claude/chat.js';

export const chatRouter = Router();

// POST /api/chat — non-streaming
chatRouter.post('/', async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!messages?.length) {
    res.status(400).json({ error: 'messages required' });
    return;
  }
  try {
    const reply = await chat(messages);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/chat/stream — SSE streaming
chatRouter.post('/stream', async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!messages?.length) {
    res.status(400).json({ error: 'messages required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const chunk of chatStream(messages)) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  } finally {
    res.end();
  }
});
