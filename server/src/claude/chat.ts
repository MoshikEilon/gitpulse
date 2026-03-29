import Anthropic from '@anthropic-ai/sdk';
import { getContributionContext } from '../github/queries.js';

const PROJECT = process.env.ANTHROPIC_VERTEX_PROJECT_ID || 'life-on-mars';
const REGION = process.env.CLOUD_ML_REGION || 'hunky-dory';
const VERTEX_BASE = process.env.ANTHROPIC_VERTEX_BASE_URL;
const MODEL = 'claude-sonnet-4-6';

// Call the axcli Vertex proxy directly, bypassing Google auth
// VERTEX_BASE already includes /v1, so path must not repeat it
async function vertexRequest(body: object): Promise<Response> {
  const base = VERTEX_BASE!.replace(/\/+$/, '');
  const url = `${base}/projects/${PROJECT}/locations/${REGION}/publishers/anthropic/models/${MODEL}:rawPredict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anthropic_version: 'vertex-2023-10-16', ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex proxy error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

const anthropic = VERTEX_BASE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  const systemPrompt = await getContributionContext();
  const body = {
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };

  if (VERTEX_BASE) {
    const res = await vertexRequest(body);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const block = data.content[0];
    if (block?.type === 'text') return block.text;
    return 'No response generated.';
  }

  const response = await anthropic!.messages.create({ model: MODEL, ...body });
  const block = response.content[0];
  if (block.type === 'text') return block.text;
  return 'No response generated.';
}

export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
  const systemPrompt = await getContributionContext();
  const body = {
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
  };

  if (VERTEX_BASE) {
    const res = await vertexRequest(body);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') return;
        try {
          const event = JSON.parse(json);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            yield event.delta.text;
          }
        } catch { /* skip malformed lines */ }
      }
    }
    return;
  }

  const stream = anthropic!.messages.stream({ model: MODEL, ...body });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}
