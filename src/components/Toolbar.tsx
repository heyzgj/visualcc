import { useSessionStore } from '../stores/sessionStore';
import { useThemeStore } from '../stores/themeStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useReactFlow } from '@xyflow/react';
// ModeSwitch hidden for v1 — Vacation Mode deferred to v2
// import ModeSwitch from './ModeSwitch';

/**
 * Canvas-specific toolbar controls (Founder Mode only).
 * Must be rendered inside ReactFlowProvider.
 */
export function CanvasToolbar() {
  const sessions = useSessionStore((s) => s.sessions);
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { fitView, setCenter } = useReactFlow();

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

  const handleResetView = () => {
    if (sessions.length > 0) {
      fitView({ padding: 0.1, duration: 300 });
    } else {
      setCenter(400, 300, { zoom: 1, duration: 300 });
    }
  };

  return (
    <>
      <button
        className="toolbar-btn primary"
        onClick={() => setShowNewDialog(true)}
      >
        + New Session
      </button>

      <div className="toolbar-divider" />

      <button className="toolbar-btn" onClick={handleOrganize} title="Arrange sessions into a grid">
        Organize
      </button>

      <button className="toolbar-btn" onClick={handleResetView} title="Zoom to fit all sessions">
        Reset View
      </button>
    </>
  );
}

/**
 * Shared toolbar shell: renders ModeSwitch + theme/notifications.
 * Canvas-specific controls are injected as children.
 */
export default function Toolbar({ children }: { children?: React.ReactNode }) {
  const sessions = useSessionStore((s) => s.sessions);
  const { theme, toggleTheme } = useThemeStore();
  const { notificationsEnabled, toggleNotifications } = useSettingsStore();

  const liveSessions = sessions.filter((s) => !s.isGhost);

  return (
    <div className="toolbar">
      {/* Vacation Mode deferred to v2 — ModeSwitch hidden for v1 */}
      {/* <ModeSwitch /> */}
      {/* <div className="toolbar-divider" /> */}

      {children}

      {children && <div className="toolbar-divider" />}

      <button
        className="toolbar-btn"
        onClick={toggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <button
        className={`toolbar-btn ${notificationsEnabled ? '' : 'muted'}`}
        onClick={toggleNotifications}
        title={notificationsEnabled ? 'Notifications on' : 'Notifications off'}
      >
        {notificationsEnabled ? '🔔' : '🔕'}
      </button>

      {liveSessions.length > 0 && (
        <>
          <div className="toolbar-divider" />
          <span className="session-count">
            {liveSessions.length}
          </span>
        </>
      )}
    </div>
  );
}
