import { useState, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSession } from '../hooks/useSession';
import type { ToolType } from '../types/session';

export default function NewSessionDialog() {
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { createSession } = useSession();
  const [tool, setTool] = useState<ToolType>('claude');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [launching, setLaunching] = useState(false);

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
    try {
      await createSession({
        tool,
        cwd: cwd.trim(),
        initial_prompt: prompt.trim() || undefined,
      });
      setShowNewDialog(false);
    } catch (err) {
      console.error('Launch failed:', err);
    } finally {
      setLaunching(false);
    }
  }, [tool, cwd, prompt, createSession, setShowNewDialog]);

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

        {/* Initial prompt */}
        <div className="dialog-field">
          <label className="dialog-label">Initial Prompt</label>
          <textarea
            className="dialog-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Fix the failing tests in auth module"
          />
        </div>

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
            {launching ? 'Launching...' : 'Launch Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
