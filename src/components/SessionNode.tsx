import { useEffect, useRef, useCallback, memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePtyOutput } from '../hooks/usePtyOutput';
import { useSession } from '../hooks/useSession';
import { useSessionStore } from '../stores/sessionStore';
import PreviewPane from './PreviewPane';
import MarkdownPreview from './MarkdownPreview';
import QuestionCard from './QuestionCard';
import OutcomeCard from './OutcomeCard';
import type { SessionInfo, SessionStatus, SessionIntel } from '../types/session';
import type { ZoomTier } from '../hooks/useZoomLevel';
import { useThemeStore } from '../stores/themeStore';

type TileViewMode = 'auto' | 'terminal' | 'preview';
type RenderMode = 'terminal' | 'chat';

interface SessionNodeData extends SessionInfo {
  zoomTier: ZoomTier;
  renderMode: RenderMode;
  tileSize: { width: number; height: number };
  isGhost?: boolean;
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
  black: '#2a2a27',        // Offset from bg so ANSI black (code blocks, reverse video) is visible
  red: '#e06c5a',          // Brighter red for better readability
  green: '#8aa06e',        // Brighter green
  yellow: '#e0986a',       // Warmer, more visible yellow
  blue: '#7dafdb',         // Brighter blue — Claude Code uses blue extensively
  magenta: '#c4a0d0',      // Distinct purple instead of gray
  cyan: '#7dc4c4',         // Teal instead of duplicating blue
  white: '#faf9f5',
  brightBlack: '#706f6a',
  brightRed: '#f08070',
  brightGreen: '#a0b87e',
  brightYellow: '#f0b080',
  brightBlue: '#90c0e8',
  brightMagenta: '#d4b0e0',
  brightCyan: '#90d4d4',
  brightWhite: '#ffffff',
};

const LIGHT_THEME = {
  background: '#faf9f5',
  foreground: '#141413',
  cursor: '#d97757',
  cursorAccent: '#faf9f5',
  selectionBackground: 'rgba(217, 119, 87, 0.2)',
  selectionForeground: '#141413',
  black: '#141413',
  red: '#b83a30',
  green: '#4a6030',        // Darker green for light bg contrast
  yellow: '#a85828',       // Darker warm orange
  blue: '#2a6090',         // Darker blue for light bg readability
  magenta: '#7a5090',      // Distinct purple
  cyan: '#2a7878',         // Darker teal
  white: '#e8e4d8',        // Offset from bg so ANSI white is visible (not identical to bg)
  brightBlack: '#585550',
  brightRed: '#c44838',
  brightGreen: '#5a7040',
  brightYellow: '#b86830',
  brightBlue: '#3a70a0',
  brightMagenta: '#8a60a0',
  brightCyan: '#3a8888',
  brightWhite: '#ede9e0',  // Still light but visibly different from #faf9f5 bg
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 900;

const EMPTY_INTEL: SessionIntel = {
  lastActivity: '',
  detectedUrl: null,
  pendingQuestion: null,
  outcome: null,
};

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
  const { closeSession, killSession, killTmuxSessionByName, writeToSession, resizeSession, relaunchSession, reattachSession } = useSession();
  const removeGhost = useSessionStore((s) => s.removeGhost);
  const theme = useThemeStore((s) => s.theme);
  const intel = useSessionStore((s) => s.sessionIntel[nodeData.id]) ?? EMPTY_INTEL;
  const isGhost = nodeData.isGhost === true;
  const isCompact = nodeData.zoomTier === 'compact';
  const isThumbnail = nodeData.zoomTier === 'thumbnail';
  const isChatMode = !isGhost && nodeData.renderMode === 'chat';
  const isTerminalMode = !isGhost && nodeData.renderMode === 'terminal';
  const isDone = nodeData.status === 'done' || nodeData.status === 'error';

  // View mode: auto picks best view, user can toggle to terminal
  const [viewMode, setViewMode] = useState<TileViewMode>('auto');

  // Determine preview URL (configured > auto-detected)
  const previewUrl = nodeData.previewUrl || intel.detectedUrl;

  // Determine if we should show terminal (user forced or no preview available)
  const isInteractive = !isCompact && !isThumbnail;
  const showTerminal = isInteractive && isTerminalMode && (
    viewMode === 'terminal' || (viewMode === 'auto' && !previewUrl)
  );
  const showPreview = isInteractive && !isGhost && viewMode !== 'terminal' && previewUrl && !isDone;
  const showMarkdown = isInteractive && isChatMode && viewMode !== 'terminal' && !previewUrl && !isDone;

  // Only create xterm instances when we need to show the terminal
  const shouldHaveTerminal = showTerminal && !isGhost;

  const tileSize = nodeData.tileSize ?? { width: 560, height: 420 };
  const [resizing, setResizing] = useState(false);

  // Display name: taskTitle > label
  const displayTitle = nodeData.taskTitle || nodeData.label;
  const toolLabel = nodeData.tool === 'claude' ? 'Claude Code' : 'Codex';
  const shortPath = nodeData.cwd.replace(/^\/Users\/[^/]+/, '~');

  // Create/dispose terminal based on whether we need it
  useEffect(() => {
    if (!shouldHaveTerminal || !termRef.current) return;

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
  }, [nodeData.id, shouldHaveTerminal]);

  // Update terminal theme
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    term.refresh(0, term.rows - 1);
  }, [theme]);

  // Refit on container size changes
  useEffect(() => {
    if (!shouldHaveTerminal || !fitAddonRef.current || !termRef.current) return;
    const observer = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore
      }
    });
    observer.observe(termRef.current);
    return () => observer.disconnect();
  }, [shouldHaveTerminal]);

  // Listen to PTY output
  usePtyOutput(shouldHaveTerminal ? nodeData.id : '', terminalRef.current);

  // Stop wheel events from leaking to d3-zoom
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const stopWheel = (e: WheelEvent) => { e.stopPropagation(); };
    node.addEventListener('wheel', stopWheel, { passive: true });
    return () => node.removeEventListener('wheel', stopWheel);
  }, []);

  const handleClose = useCallback(async (e?: React.MouseEvent) => {
    if (isGhost) {
      // For live ghosts, shift+click kills the tmux session; otherwise just dismiss
      if (nodeData.isLiveGhost && nodeData.tmuxName && e?.shiftKey) {
        await killTmuxSessionByName(nodeData.tmuxName);
      }
      removeGhost(nodeData.id);
    } else if (e?.shiftKey) {
      // Shift+click: kill entirely (including tmux session)
      await killSession(nodeData.id);
    } else {
      // Normal click: detach (tmux keeps running) or kill (direct PTY)
      await closeSession(nodeData.id);
    }
  }, [nodeData.id, nodeData.isLiveGhost, nodeData.tmuxName, isGhost, closeSession, killSession, killTmuxSessionByName, removeGhost]);

  const handleRelaunch = useCallback(async () => {
    try {
      await relaunchSession(nodeData.id);
    } catch {
      // Error already logged
    }
  }, [nodeData.id, relaunchSession]);

  const handleReattach = useCallback(async () => {
    try {
      await reattachSession(nodeData.id);
    } catch {
      // Error already logged
    }
  }, [nodeData.id, reattachSession]);

  const switchToTerminal = useCallback(() => setViewMode('terminal'), []);
  const switchToAuto = useCallback(() => setViewMode('auto'), []);

  const handleDismissQuestion = useCallback(() => {
    useSessionStore.getState().updateIntel(nodeData.id, { pendingQuestion: null });
  }, [nodeData.id]);

  // Resize handle
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

  // Get markdown content for chat mode preview
  // Markdown content extraction is reserved for future structured output mode
  const markdownContent = '';

  // --- Render ---

  const renderContent = () => {
    // Ghost tiles
    if (isGhost) {
      const isLive = nodeData.isLiveGhost === true;
      return (
        <div className="tile-ghost">
          <div className="ghost-icon" style={{
            background: isLive
              ? 'rgba(138, 160, 110, 0.15)'
              : nodeData.tool === 'claude' ? 'rgba(217, 119, 87, 0.1)' : 'rgba(176, 174, 165, 0.1)',
            color: isLive
              ? 'var(--status-running)'
              : nodeData.tool === 'claude' ? 'var(--status-active)' : 'var(--text-secondary)',
          }}>
            {isLive ? (
              <span className="live-ghost-pulse" />
            ) : (
              nodeData.tool === 'claude' ? 'C' : 'X'
            )}
          </div>
          {nodeData.taskTitle && <div className="ghost-task-title">{nodeData.taskTitle}</div>}
          <div className="ghost-label">{isLive ? 'Session still running' : 'Previous session'}</div>
          {isLive ? (
            <button className="ghost-relaunch-btn ghost-reattach-btn" onClick={handleReattach}>Reattach</button>
          ) : (
            <button className="ghost-relaunch-btn" onClick={handleRelaunch}>Re-launch</button>
          )}
        </div>
      );
    }

    // Compact zoom (< 0.3) — icon + title + status
    if (isCompact) {
      return (
        <div className="tile-compact">
          <div className="compact-icon" style={{
            background: nodeData.tool === 'claude' ? 'rgba(217, 119, 87, 0.15)' : 'rgba(176, 174, 165, 0.15)',
            color: nodeData.tool === 'claude' ? 'var(--status-active)' : 'var(--text-secondary)',
          }}>
            {nodeData.tool === 'claude' ? 'C' : 'X'}
          </div>
          <div className="compact-label">{displayTitle}</div>
          {intel.pendingQuestion && <div className="question-badge">⚠</div>}
        </div>
      );
    }

    // Thumbnail zoom (0.3-0.7) — smart card with subtitle + inline question
    if (isThumbnail) {
      return (
        <div className="smart-card">
          <div className="smart-card-title">{displayTitle}</div>
          {intel.lastActivity && (
            <div className="smart-card-subtitle">{intel.lastActivity}</div>
          )}
          {isDone && intel.outcome && (
            <OutcomeCard outcome={intel.outcome} sessionId={nodeData.id} status={nodeData.status as 'done' | 'error'} />
          )}
          {intel.pendingQuestion && (
            <QuestionCard
              question={intel.pendingQuestion}
              sessionId={nodeData.id}
              onDismiss={handleDismissQuestion}
              onSwitchToTerminal={switchToTerminal}
              compact
            />
          )}
          {!intel.lastActivity && !intel.pendingQuestion && !isDone && (
            <div className="smart-card-waiting">Waiting for output...</div>
          )}
        </div>
      );
    }

    // Interactive+ zoom (> 0.7) — preview or terminal
    // Done state: show outcome
    if (isDone && intel.outcome) {
      return (
        <div className="tile-done-wrapper">
          <OutcomeCard outcome={intel.outcome} sessionId={nodeData.id} status={nodeData.status as 'done' | 'error'} />
          {showTerminal && <div className="tile-terminal" ref={termRef} />}
        </div>
      );
    }

    // Live iframe preview
    if (showPreview) {
      return (
        <>
          <PreviewPane url={previewUrl!} sessionId={nodeData.id} onSwitchToTerminal={switchToTerminal} />
          {intel.pendingQuestion && (
            <QuestionCard
              question={intel.pendingQuestion}
              sessionId={nodeData.id}
              onDismiss={handleDismissQuestion}
              onSwitchToTerminal={switchToTerminal}
            />
          )}
        </>
      );
    }

    // Markdown preview (chat mode, no preview URL)
    if (showMarkdown && markdownContent) {
      return (
        <>
          <MarkdownPreview content={markdownContent} sessionId={nodeData.id} onSwitchToTerminal={switchToTerminal} />
          {intel.pendingQuestion && (
            <QuestionCard
              question={intel.pendingQuestion}
              sessionId={nodeData.id}
              onDismiss={handleDismissQuestion}
              onSwitchToTerminal={switchToTerminal}
            />
          )}
        </>
      );
    }

    // Terminal view (default for terminal mode or user toggle)
    if (shouldHaveTerminal) {
      return (
        <>
          <div className="tile-terminal" ref={termRef} />
          {intel.pendingQuestion && (
            <QuestionCard
              question={intel.pendingQuestion}
              sessionId={nodeData.id}
              onDismiss={handleDismissQuestion}
              onSwitchToTerminal={switchToTerminal}
            />
          )}
        </>
      );
    }

    // Fallback compact
    return (
      <div className="tile-compact">
        <div className="compact-icon" style={{
          background: nodeData.tool === 'claude' ? 'rgba(217, 119, 87, 0.15)' : 'rgba(176, 174, 165, 0.15)',
          color: nodeData.tool === 'claude' ? 'var(--status-active)' : 'var(--text-secondary)',
        }}>
          {nodeData.tool === 'claude' ? 'C' : 'X'}
        </div>
        <div className="compact-label">{displayTitle}</div>
        {isThumbnail && <div className="compact-hint">Zoom in to interact</div>}
      </div>
    );
  };

  return (
    <div
      className={`session-node ${resizing ? 'resizing' : ''} ${isGhost ? 'session-node--ghost' : ''}`}
      data-status={nodeData.status}
      ref={nodeRef}
      style={{ width: tileSize.width, height: tileSize.height }}
    >
      <Handle type="target" position={Position.Top} style={{ display: 'none' }} />

      {/* Header */}
      <div className="tile-header">
        <div className={`tool-icon ${nodeData.tool}`} />
        <span className="session-label">{nodeData.taskTitle ? displayTitle : toolLabel}</span>
        <span className="session-path">{nodeData.taskTitle ? toolLabel : shortPath}</span>
        {/* View toggle (only at interactive+ zoom, not ghost, not done) */}
        {isInteractive && !isGhost && !isDone && (
          <button
            className="tile-view-toggle"
            onClick={viewMode === 'terminal' ? switchToAuto : switchToTerminal}
            title={viewMode === 'terminal' ? 'Show preview' : 'Show terminal'}
          >
            {viewMode === 'terminal' ? '◫' : '⌨'}
          </button>
        )}
        <button
          className="close-btn"
          onClick={(e) => handleClose(e)}
          title={isGhost ? (nodeData.isLiveGhost ? 'Dismiss (Shift+click to kill)' : 'Dismiss') : (nodeData.tmuxName ? 'Detach (Shift+click to kill)' : 'Kill session')}
        >
          &times;
        </button>
      </div>

      {/* Smart subtitle (visible at interactive+ zoom when not in done state) */}
      {isInteractive && !isGhost && !isDone && intel.lastActivity && (
        <div className="tile-subtitle">
          <span className={`status-dot-inline ${nodeData.status}`} />
          {intel.lastActivity}
        </div>
      )}

      {/* Content area */}
      <div className="tile-content-wrapper">
        {renderContent()}
      </div>

      {/* Footer */}
      <div className="tile-footer">
        {isGhost ? (
          <span className="session-timer ghost-hint">{nodeData.isLiveGhost ? 'tmux session alive' : 'Saved session'}</span>
        ) : (
          <span className="session-timer">{formatDuration(elapsed)}</span>
        )}
        <div className="status-badge">
          <span className={`status-dot ${nodeData.isLiveGhost ? 'running' : nodeData.status}`} />
          <span style={{ color: nodeData.isLiveGhost ? 'var(--status-running)' : `var(--status-${nodeData.status === 'done' ? 'idle' : nodeData.status})` }}>
            {isGhost ? (nodeData.isLiveGhost ? 'Live' : 'Ghost') : STATUS_LABELS[nodeData.status]}
          </span>
        </div>
      </div>

      {/* Resize handle */}
      <div className="tile-resize-handle" onMouseDown={handleResizeStart} />

      <Handle type="source" position={Position.Bottom} style={{ display: 'none' }} />
    </div>
  );
}

export default memo(SessionNodeComponent);
