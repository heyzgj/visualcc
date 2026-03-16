import { useSessionStore } from '../stores/sessionStore';
import { useThemeStore } from '../stores/themeStore';
import { useReactFlow } from '@xyflow/react';

export default function Toolbar() {
  const sessions = useSessionStore((s) => s.sessions);
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { theme, toggleTheme } = useThemeStore();
  const { fitView, setCenter } = useReactFlow();

  // Arrange into grid + zoom to fit
  const handleOrganize = () => {
    if (sessions.length === 0) return;

    const cols = Math.ceil(Math.sqrt(sessions.length));
    const tileW = 600;
    const tileH = 460;
    const gap = 50;
    const updatePosition = useSessionStore.getState().updatePosition;

    sessions.forEach((session, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      updatePosition(session.id, 100 + col * (tileW + gap), 100 + row * (tileH + gap));
    });

    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50);
  };

  // Reset zoom to fit all sessions
  const handleResetView = () => {
    if (sessions.length > 0) {
      fitView({ padding: 0.1, duration: 300 });
    } else {
      setCenter(400, 300, { zoom: 1, duration: 300 });
    }
  };

  return (
    <div className="toolbar">
      <button
        className="toolbar-btn primary"
        onClick={() => setShowNewDialog(true)}
      >
        + New Session
      </button>

      <div className="toolbar-divider" />

      <button
        className="toolbar-btn"
        onClick={handleOrganize}
        title="Arrange all sessions into a clean grid and zoom to fit"
      >
        Organize
      </button>

      <button
        className="toolbar-btn"
        onClick={handleResetView}
        title="Reset zoom to fit all sessions in view"
      >
        Reset View
      </button>

      <div className="toolbar-divider" />

      <button
        className="toolbar-btn"
        onClick={toggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>

      <div className="toolbar-divider" />

      <span className="session-count">
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
