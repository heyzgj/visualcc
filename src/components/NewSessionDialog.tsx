import { useState, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSession } from '../hooks/useSession';
import { useFavoritesStore } from '../stores/favoritesStore';
import type { ToolType } from '../types/session';

export default function NewSessionDialog() {
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { createSession } = useSession();
  const favorites = useFavoritesStore((s) => s.favorites);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const isFavorited = useFavoritesStore((s) => s.isFavorited);
  const [tool, setTool] = useState<ToolType>('claude');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
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
        taskTitle: taskTitle.trim() || undefined,
        previewUrl: previewUrl.trim() || undefined,
      });
      setShowNewDialog(false);
    } catch (err) {
      console.error('Launch failed:', err);
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

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="favorites-section">
            <label className="dialog-label">Favorites</label>
            <div className="favorites-chips">
              {favorites.map((fav) => (
                <button
                  key={fav.id}
                  className="favorite-chip"
                  onClick={() => {
                    setTool(fav.tool);
                    setCwd(fav.cwd);
                  }}
                  title={fav.cwd}
                >
                  <span className={`fav-dot ${fav.tool}`} />
                  <span className="fav-label">{fav.label}</span>
                  <span
                    className="fav-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavorite(fav.id);
                    }}
                  >
                    &times;
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
            {cwd.trim() && !isFavorited(tool, cwd.trim()) && (
              <button
                className="dialog-browse-btn fav-save"
                onClick={() => addFavorite(tool, cwd.trim())}
                title="Save as favorite"
              >
                ★
              </button>
            )}
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
          <label className="dialog-label">Initial Prompt</label>
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
