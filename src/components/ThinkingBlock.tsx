import { memo, useState } from 'react';

interface ThinkingBlockProps {
  thinking: string;
}

function ThinkingBlockComponent({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const preview = thinking.length > 120 ? thinking.slice(0, 120) + '...' : thinking;

  return (
    <div className={`chat-thinking ${expanded ? 'expanded' : ''}`}>
      <button
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="thinking-icon">{expanded ? '▾' : '▸'}</span>
        <span className="thinking-label">Thinking</span>
      </button>
      {expanded && (
        <div className="thinking-content">
          {thinking}
        </div>
      )}
      {!expanded && (
        <div className="thinking-preview">{preview}</div>
      )}
    </div>
  );
}

export default memo(ThinkingBlockComponent);
