import { useState, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSession } from '../hooks/useSession';
import { useRecentsStore } from '../stores/recentsStore';
import type { ToolType } from '../types/session';

export default function NewSessionDialog() {
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { createSession } = useSession();
  const recents = useRecentsStore((s) => s.recents);
  const [tool, setTool] = useState<ToolType>('claude');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, title: 'Select project directory' });
      if (dir) setCwd(dir as string);
    } catch {
      // Fallback: let user type manually
    }
  }, []);

  const handleLaunch = useCallback(async () => {
    if (!cwd.trim()) return;
    setLaunching(true);
    setError(null);
    try {
      await createSession({
        tool,
        cwd: cwd.trim(),
        initial_prompt: prompt.trim() || undefined,
        taskTitle: taskTitle.trim() || undefined,
        previewUrl: previewUrl.trim() || undefined,
      });
      // Track in recents
      useRecentsStore.getState().addRecent(tool, cwd.trim());
      setShowNewDialog(false);
    } catch (err) {
      console.error('Launch failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }, [tool, cwd, prompt, taskTitle, previewUrl, createSession, setShowNewDialog]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) setShowNewDialog(false);
    },
    [setShowNewDialog]
  );

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div className="new-session-dialog">
        <h2 className="dialog-title">New Session</h2>

        {/* Tool selector */}
        <div className="tool-cards">
          <div
            className={`tool-card ${tool === 'claude' ? 'selected' : ''}`}
            onClick={() => setTool('claude')}
          >
            <div className="tool-card-icon claude">C</div>
            <div className="tool-card-name">Claude Code</div>
          </div>
          <div
            className={`tool-card codex ${tool === 'codex' ? 'selected codex' : ''}`}
            onClick={() => setTool('codex')}
          >
            <div className="tool-card-icon codex">X</div>
            <div className="tool-card-name">Codex</div>
          </div>
        </div>

        {/* Directory picker */}
        <div className="dialog-field">
          <label className="dialog-label">Project Directory</label>
          <div className="dialog-input-row">
            <input
              className="dialog-input"
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
            />
            <button className="dialog-browse-btn" onClick={handleBrowse}>
              Browse
            </button>
          </div>
        </div>

        {/* Task name */}
        <div className="dialog-field">
          <label className="dialog-label">Task Name <span className="dialog-optional">(optional)</span></label>
          <input
            className="dialog-input"
            type="text"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="What are you working on?"
          />
        </div>

        {/* Initial prompt */}
        <div className="dialog-field">
          <label className="dialog-label">Initial Prompt <span className="dialog-optional">(optional)</span></label>
          <textarea
            className="dialog-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Fix the failing tests in auth module"
          />
        </div>

        {/* Preview URL */}
        <div className="dialog-field">
          <label className="dialog-label">Preview URL <span className="dialog-optional">(auto-detected)</span></label>
          <input
            className="dialog-input"
            type="text"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="e.g., http://localhost:3000"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="dialog-error">
            Launch failed: {error}
          </div>
        )}

        {/* Actions */}
        <div className="dialog-actions">
          <button
            className="dialog-btn cancel"
            onClick={() => setShowNewDialog(false)}
          >
            Cancel
          </button>
          <button
            className="dialog-btn launch"
            onClick={handleLaunch}
            disabled={!cwd.trim() || launching}
          >
            {launching ? 'Launching...' : 'Launch'}
          </button>
        </div>

        {/* Recent directories */}
        {recents.length > 0 && (
          <div className="recents-section">
            <label className="dialog-label recents-label">Recent</label>
            <div className="recents-list">
              {recents.map((r, i) => (
                <button
                  key={`${r.cwd}-${i}`}
                  className="recent-item"
                  onClick={() => {
                    setTool(r.tool);
                    setCwd(r.cwd);
                  }}
                  title={r.cwd}
                >
                  <span className={`recent-dot ${r.tool}`} />
                  <span className="recent-label">{r.label}</span>
                  <span className="recent-path">{r.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
