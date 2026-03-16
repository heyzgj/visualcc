import { memo, useState } from 'react';
import type { ToolUseBlock, ToolResultBlock } from '../adapters/types';

interface ToolCallCardProps {
  toolUse: ToolUseBlock;
  toolResult?: ToolResultBlock;
}

function ToolCallCardComponent({ toolUse, toolResult }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const inputStr = typeof toolUse.input === 'string'
    ? toolUse.input
    : JSON.stringify(toolUse.input, null, 2);

  return (
    <div className={`chat-tool-card ${toolResult?.isError ? 'error' : ''}`}>
      <button
        className="tool-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tool-card-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="tool-card-icon-small">&#9881;</span>
        <span className="tool-card-name-label">{toolUse.name}</span>
        {toolResult && (
          <span className={`tool-card-status ${toolResult.isError ? 'error' : 'success'}`}>
            {toolResult.isError ? 'Failed' : 'Done'}
          </span>
        )}
      </button>

      {expanded && (
        <div className="tool-card-body">
          <div className="tool-card-section">
            <div className="tool-card-section-label">Input</div>
            <pre className="tool-card-pre">{inputStr}</pre>
          </div>
          {toolResult && (
            <div className="tool-card-section">
              <div className="tool-card-section-label">
                {toolResult.isError ? 'Error' : 'Output'}
              </div>
              <pre className={`tool-card-pre ${toolResult.isError ? 'error-text' : ''}`}>
                {toolResult.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ToolCallCardComponent);
