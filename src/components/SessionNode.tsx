import { useEffect, useRef, useCallback, memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePtyOutput } from '../hooks/usePtyOutput';
import { useStructuredOutput } from '../hooks/useStructuredOutput';
import { useSession } from '../hooks/useSession';
import { useSessionStore } from '../stores/sessionStore';
import ChatView from './ChatView';
import type { SessionInfo, SessionStatus } from '../types/session';
import type { RenderMode } from '../adapters/types';
import type { ZoomTier } from '../hooks/useZoomLevel';
import { useThemeStore } from '../stores/themeStore';

interface SessionNodeData extends SessionInfo {
  zoomTier: ZoomTier;
  renderMode: RenderMode;
  tileSize: { width: number; height: number };
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  active: 'Needs Input',
  error: 'Error',
  done: 'Done',
};

const DARK_THEME = {
  background: '#141413',
  foreground: '#faf9f5',
  cursor: '#d97757',
  cursorAccent: '#141413',
  selectionBackground: 'rgba(217, 119, 87, 0.3)',
  selectionForeground: '#faf9f5',
  black: '#141413',
  red: '#c4443a',
  green: '#788c5d',
  yellow: '#d97757',
  blue: '#6a9bcc',
  magenta: '#b0aea5',
  cyan: '#6a9bcc',
  white: '#faf9f5',
  brightBlack: '#706f6a',
  brightRed: '#d97757',
  brightGreen: '#8aa06e',
  brightYellow: '#e0986a',
  brightBlue: '#7dafdb',
  brightMagenta: '#c4bfb6',
  brightCyan: '#7dafdb',
  brightWhite: '#faf9f5',
};

const LIGHT_THEME = {
  background: '#faf9f5',
  foreground: '#141413',
  cursor: '#d97757',
  cursorAccent: '#faf9f5',
  selectionBackground: 'rgba(217, 119, 87, 0.2)',
  selectionForeground: '#141413',
  black: '#141413',
  red: '#c4443a',
  green: '#5a6e42',
  yellow: '#c06840',
  blue: '#4a7eab',
  magenta: '#8a877e',
  cyan: '#4a7eab',
  white: '#faf9f5',
  brightBlack: '#706f6a',
  brightRed: '#d97757',
  brightGreen: '#788c5d',
  brightYellow: '#d97757',
  brightBlue: '#6a9bcc',
  brightMagenta: '#b0aea5',
  brightCyan: '#6a9bcc',
  brightWhite: '#faf9f5',
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 900;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function SessionNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as SessionNodeData;
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const { killSession, killStructuredSession, writeToSession, resizeSession } = useSession();
  const theme = useThemeStore((s) => s.theme);
  const isCompact = nodeData.zoomTier === 'compact';
  const isChatMode = nodeData.renderMode === 'chat';
  const isTerminalMode = nodeData.renderMode === 'terminal';

  const tileSize = nodeData.tileSize ?? { width: 560, height: 420 };
  const [resizing, setResizing] = useState(false);

  // Listen to structured output for chat mode sessions
  useStructuredOutput(
    isChatMode ? nodeData.id : '',
    nodeData.tool
  );

  // Initialize terminal ONCE — only for terminal mode sessions
  useEffect(() => {
    if (isChatMode || !termRef.current) return;

    const terminal = new Terminal({
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      fontFamily: "'JetBrains Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during initialization
      }
    });

    terminal.onData((inputData) => {
      writeToSession(nodeData.id, inputData);
    });

    terminal.onResize(({ cols, rows }) => {
      resizeSession(nodeData.id, cols, rows);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [nodeData.id, isChatMode]);

  // Update terminal theme when app theme changes.
  // Must refresh all rows after setting theme — xterm's canvas renderer
  // caches glyph textures with the old colors and won't repaint without it.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    term.refresh(0, term.rows - 1);
  }, [theme]);

  // Refit on container size changes (terminal mode only)
  useEffect(() => {
    if (isChatMode || !fitAddonRef.current || !termRef.current) return;
    const observer = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore
      }
    });
    observer.observe(termRef.current);
    return () => observer.disconnect();
  }, [isChatMode]);

  // Listen to PTY output (terminal mode only)
  usePtyOutput(isTerminalMode ? nodeData.id : '', terminalRef.current);

  // Stop wheel events from propagating to ReactFlow's d3-zoom.
  // MUST be a native DOM listener — React synthetic onWheel fires after
  // d3-zoom's native listener (delegated to root), so stopPropagation
  // via React is too late. Native listener on .session-node fires during
  // bubbling BEFORE the event reaches the ReactFlow pane.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    const stopWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    node.addEventListener('wheel', stopWheel, { passive: true });
    return () => node.removeEventListener('wheel', stopWheel);
  }, []);

  const handleClose = useCallback(async () => {
    if (isChatMode) {
      await killStructuredSession(nodeData.id);
    } else {
      await killSession(nodeData.id);
    }
  }, [nodeData.id, isChatMode, killSession, killStructuredSession]);

  // Resize handle drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = tileSize.width;
    const startH = tileSize.height;

    const onMouseMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + (ev.clientY - startY)));
      useSessionStore.getState().updateTileSize(nodeData.id, newW, newH);
    };

    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [nodeData.id, tileSize.width, tileSize.height]);

  const elapsed = Date.now() - nodeData.created_at;
  const toolLabel = nodeData.tool === 'claude' ? 'Claude Code' : 'Codex';
  const shortPath = nodeData.cwd.replace(/^\/Users\/[^/]+/, '~');

  // Get last message preview for thumbnail zoom
  const messages = useSessionStore((s) => s.messages[nodeData.id] ?? []);
  const lastTextMessage = messages
    .filter((m) => m.type === 'assistant_message')
    .at(-1);
  const previewText = lastTextMessage?.type === 'assistant_message'
    ? lastTextMessage.blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join(' ')
        .slice(0, 200)
    : '';

  const isThumbnail = nodeData.zoomTier === 'thumbnail';

  return (
    <div
      className={`session-node ${resizing ? 'resizing' : ''}`}
      data-status={nodeData.status}
      ref={nodeRef}
      style={{ width: tileSize.width, height: tileSize.height }}
    >
      <Handle type="target" position={Position.Top} style={{ display: 'none' }} />

      {/* Header */}
      <div className="tile-header">
        <div className={`tool-icon ${nodeData.tool}`} />
        <span className="session-label">{toolLabel}</span>
        <span className="session-path">{shortPath}</span>
        <button className="close-btn" onClick={handleClose} title="Kill session">
          &times;
        </button>
      </div>

      {/* Content area */}
      <div className="tile-content-wrapper">
        {isCompact ? (
          <div className="tile-compact">
            <div
              className="compact-icon"
              style={{
                background:
                  nodeData.tool === 'claude'
                    ? 'rgba(217, 119, 87, 0.15)'
                    : 'rgba(176, 174, 165, 0.15)',
                color:
                  nodeData.tool === 'claude'
                    ? 'var(--status-active)'
                    : 'var(--text-secondary)',
              }}
            >
              {nodeData.tool === 'claude' ? 'C' : 'X'}
            </div>
            <div className="compact-label">{nodeData.label}</div>
          </div>
        ) : isChatMode && isThumbnail ? (
          <div className="chat-preview">
            <div className="chat-preview-text">
              {previewText || 'Waiting for output...'}
            </div>
          </div>
        ) : isChatMode ? (
          <ChatView sessionId={nodeData.id} tool={nodeData.tool} />
        ) : (
          <div
            className="tile-terminal"
            ref={termRef}
            style={{ display: isCompact ? 'none' : undefined }}
          />
        )}
      </div>

      {/* Terminal ref for terminal mode (needs to be always in DOM) */}
      {isTerminalMode && isCompact && (
        <div className="tile-terminal" ref={termRef} style={{ display: 'none' }} />
      )}

      {/* Footer */}
      <div className="tile-footer">
        <span className="session-timer">{formatDuration(elapsed)}</span>
        <div className="status-badge">
          <span className={`status-dot ${nodeData.status}`} />
          <span style={{ color: `var(--status-${nodeData.status === 'done' ? 'idle' : nodeData.status})` }}>
            {STATUS_LABELS[nodeData.status]}
          </span>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="tile-resize-handle"
        onMouseDown={handleResizeStart}
      />

      <Handle type="source" position={Position.Bottom} style={{ display: 'none' }} />
    </div>
  );
}

export default memo(SessionNodeComponent);
