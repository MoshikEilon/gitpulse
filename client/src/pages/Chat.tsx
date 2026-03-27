import { useState, useRef, useEffect } from 'react';
import { api, ChatMessage } from '../lib/api.ts';

const SUGGESTIONS = [
  'What are my most active repos?',
  'How many PRs did I merge last year?',
  'What languages do I use the most?',
  'Show me my contribution trends over time',
  'Which month was I most productive?',
  'What is my PR merge rate?',
];

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text?: string) => {
    const userText = text ?? input.trim();
    if (!userText || streaming) return;
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    // Add placeholder assistant message
    const assistantIdx = newMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      let full = '';
      for await (const chunk of api.chatStream(newMessages)) {
        full += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: full };
          return updated;
        });
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', content: `Sorry, something went wrong: ${err}` };
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h1 className="page-title">AI Chat</h1>
        <p className="chat-subtitle">Ask anything about your GitHub contributions, patterns, and history.</p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <h3>Ask me anything about your code</h3>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-avatar">{m.role === 'user' ? '👤' : '🤖'}</div>
            <div className="chat-bubble">
              <MessageContent content={m.content} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your contributions… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={streaming}
        />
        <button
          className="btn btn-primary chat-send"
          onClick={() => send()}
          disabled={!input.trim() || streaming}
        >
          {streaming ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}

function MessageContent({ content, streaming }: { content: string; streaming: boolean }) {
  if (!content && streaming) {
    return <span className="cursor-blink">▌</span>;
  }
  // Simple markdown: bold, code blocks, inline code
  const lines = content.split('\n');
  return (
    <div className="msg-content">
      {lines.map((line, i) => {
        const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {parts.map((p, j) => {
              if (p.startsWith('`') && p.endsWith('`')) return <code key={j} className="inline-code">{p.slice(1, -1)}</code>;
              if (p.startsWith('**') && p.endsWith('**')) return <strong key={j}>{p.slice(2, -2)}</strong>;
              return p;
            })}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
      {streaming && <span className="cursor-blink">▌</span>}
    </div>
  );
}
