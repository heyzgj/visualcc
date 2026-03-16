import { memo, useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import MarkdownBlock from './MarkdownBlock';
import ThinkingBlock from './ThinkingBlock';
import ToolCallCard from './ToolCallCard';
import ChatInput from './ChatInput';
import type { ChatEvent, ContentBlock, ToolUseBlock, ToolResultBlock } from '../adapters/types';
import type { ToolType } from '../types/session';
import { claudeAdapter } from '../adapters/claudeAdapter';
import { codexAdapter } from '../adapters/codexAdapter';

interface ChatViewProps {
  sessionId: string;
  tool: ToolType;
}

function renderBlock(block: ContentBlock, index: number, allBlocks: ContentBlock[]) {
  switch (block.type) {
    case 'text':
      return <MarkdownBlock key={index} text={block.text} />;

    case 'thinking':
      return <ThinkingBlock key={index} thinking={block.thinking} />;

    case 'tool_use': {
      // Try to find matching tool_result
      const result = allBlocks.find(
        (b): b is ToolResultBlock =>
          b.type === 'tool_result' && b.toolUseId === block.id
      );
      return (
        <ToolCallCard
          key={index}
          toolUse={block as ToolUseBlock}
          toolResult={result}
        />
      );
    }

    case 'tool_result':
      // Already rendered with its tool_use card — skip standalone
      // unless there's no matching tool_use in this event
      return null;

    case 'code':
      return (
        <div key={index} className="chat-code-standalone">
          <pre className="tool-card-pre">{block.code}</pre>
        </div>
      );

    default:
      return null;
  }
}

function renderEvent(event: ChatEvent, index: number) {
  switch (event.type) {
    case 'system':
      return (
        <div key={index} className="chat-event chat-system">
          <span className="chat-system-dot" />
          <span>{event.message}</span>
        </div>
      );

    case 'assistant_message':
      return (
        <div key={index} className="chat-event chat-assistant">
          {event.blocks.map((block, bi) => renderBlock(block, bi, event.blocks))}
        </div>
      );

    case 'user_message':
      return (
        <div key={index} className="chat-event chat-user">
          {event.blocks.map((block, bi) => renderBlock(block, bi, event.blocks))}
        </div>
      );

    case 'result':
      return (
        <div key={index} className={`chat-event chat-result ${event.subtype}`}>
          <div className="result-header">
            {event.subtype === 'success' ? 'Session completed' : 'Session error'}
          </div>
          {event.costUsd != null && (
            <span className="result-meta">Cost: ${event.costUsd.toFixed(4)}</span>
          )}
          {event.durationMs != null && (
            <span className="result-meta">
              Duration: {(event.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {event.totalTokens != null && (
            <span className="result-meta">
              Tokens: {event.totalTokens.toLocaleString()}
            </span>
          )}
        </div>
      );

    case 'rate_limit':
      return (
        <div key={index} className="chat-event chat-rate-limit">
          <span className="rate-limit-icon">&#9888;</span>
          <span>{event.message}</span>
          {event.retrySec && <span className="rate-limit-retry">Retry in {event.retrySec}s</span>}
        </div>
      );

    case 'unknown':
      return (
        <div key={index} className="chat-event chat-unknown">
          <details>
            <summary>Unknown event: {event.rawType}</summary>
            <pre className="tool-card-pre">
              {JSON.stringify(event._raw, null, 2)}
            </pre>
          </details>
        </div>
      );

    default:
      return null;
  }
}

function ChatViewComponent({ sessionId, tool }: ChatViewProps) {
  const messages = useSessionStore((s) => s.messages[sessionId] ?? []);
  const scrollRef = useRef<HTMLDivElement>(null);

  const adapter = tool === 'claude' ? claudeAdapter : codexAdapter;
  const supportsInput = adapter.inputCapabilities.supportsInteractiveInput;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              {tool === 'claude' ? 'C' : 'X'}
            </div>
            <div className="chat-empty-text">Waiting for output...</div>
          </div>
        )}
        {messages.map((event, i) => renderEvent(event, i))}
      </div>
      <ChatInput sessionId={sessionId} supportsInput={supportsInput} />
    </div>
  );
}

export default memo(ChatViewComponent);
