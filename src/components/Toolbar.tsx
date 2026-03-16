import { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useThemeStore } from '../stores/themeStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSession } from '../hooks/useSession';
import { useReactFlow } from '@xyflow/react';

export default function Toolbar() {
  const sessions = useSessionStore((s) => s.sessions);
  const setShowNewDialog = useSessionStore((s) => s.setShowNewDialog);
  const { theme, toggleTheme } = useThemeStore();
  const favorites = useFavoritesStore((s) => s.favorites);
  const { notificationsEnabled, toggleNotifications } = useSettingsStore();
  const { createSession } = useSession();
  const { fitView, setCenter } = useReactFlow();
  const [showFavs, setShowFavs] = useState(false);
  const favsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showFavs) return;
    const handleClick = (e: MouseEvent) => {
      if (favsRef.current && !favsRef.current.contains(e.target as Node)) {
        setShowFavs(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFavs]);

  const handleFavLaunch = useCallback(
    async (tool: 'claude' | 'codex', cwd: string) => {
      setShowFavs(false);
      try {
        await createSession({ tool, cwd });
      } catch (err) {
        console.error('Failed to launch favorite:', err);
      }
    },
    [createSession]
  );

  const liveSessions = sessions.filter((s) => !s.isGhost);

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

      {favorites.length > 0 && (
        <div className="toolbar-favorites" ref={favsRef}>
          <button
            className="toolbar-btn"
            onClick={() => setShowFavs(!showFavs)}
            title="Launch a favorite"
          >
            ★ Favorites
          </button>
          {showFavs && (
            <div className="favorites-dropdown">
              {favorites.map((fav) => (
                <button
                  key={fav.id}
                  className="favorites-dropdown-item"
                  onClick={() => handleFavLaunch(fav.tool, fav.cwd)}
                >
                  <span className={`fav-dot ${fav.tool}`} />
                  <span>{fav.label}</span>
                  <span className="fav-path">{fav.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      <button
        className={`toolbar-btn ${notificationsEnabled ? '' : 'muted'}`}
        onClick={toggleNotifications}
        title={notificationsEnabled ? 'Notifications on — click to mute' : 'Notifications off — click to enable'}
      >
        {notificationsEnabled ? '🔔' : '🔕'}
      </button>

      <div className="toolbar-divider" />

      <span className="session-count">
        {liveSessions.length} session{liveSessions.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
