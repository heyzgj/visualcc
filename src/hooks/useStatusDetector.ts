import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { SessionStatus } from '../types/session';

let notifyModule: typeof import('@tauri-apps/plugin-notification') | null = null;
const notifiedSessions = new Map<string, SessionStatus>();

async function loadNotifyModule() {
  if (!notifyModule) {
    notifyModule = await import('@tauri-apps/plugin-notification');
  }
  return notifyModule;
}

async function sendNotification(title: string, body: string) {
  try {
    const mod = await loadNotifyModule();
    const perm = await mod.isPermissionGranted();
    if (!perm) {
      await mod.requestPermission();
    }
    if (await mod.isPermissionGranted()) {
      await mod.sendNotification({ title, body });
    }
  } catch {
    // Notifications not available (e.g., in dev browser mode)
  }
}

/**
 * Global hook: listens to PTY output events for all sessions,
 * tracks activity timestamps, and updates session status accordingly.
 * Sends OS notifications on status transitions to 'active' or 'error'.
 *
 * running  → output received in the last 3s
 * idle     → no output for 3–10s
 * active   → no output for 10s+ (likely waiting for user input)
 * done     → process exited (from backend event)
 */
export function useStatusDetector() {
  const sessions = useSessionStore((s) => s.sessions);
  const lastActivityRef = useRef<Map<string, number>>(new Map());
  const listenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());

  // Setup/teardown event listeners per session
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    // Add listeners for new sessions (skip ghosts)
    for (const session of sessions) {
      if (session.isGhost) continue;
      if (listenersRef.current.has(session.id)) continue;

      lastActivityRef.current.set(session.id, Date.now());
      const unlistens: UnlistenFn[] = [];
      listenersRef.current.set(session.id, unlistens);

      // Output activity — any PTY data means the session is producing output
      listen(`session:output:${session.id}`, () => {
        lastActivityRef.current.set(session.id, Date.now());
      }).then((u) => unlistens.push(u));

      // Backend status events (process exit)
      listen<string>(`session:status:${session.id}`, (event) => {
        const payload = event.payload;
        if (payload === 'done' || payload === 'error') {
          useSessionStore.getState().updateStatus(session.id, payload as SessionStatus);
          lastActivityRef.current.delete(session.id);

          // Send notification on error
          if (payload === 'error') {
            const enabled = useSettingsStore.getState().notificationsEnabled;
            if (enabled && notifiedSessions.get(session.id) !== 'error') {
              notifiedSessions.set(session.id, 'error');
              sendNotification(
                'Session Error',
                `${session.label} (${session.tool === 'claude' ? 'Claude Code' : 'Codex'}) exited with an error`
              );
            }
          }
        }
      }).then((u) => unlistens.push(u));
    }

    // Cleanup listeners for removed sessions
    for (const [id, unlistens] of listenersRef.current) {
      if (!currentIds.has(id)) {
        unlistens.forEach((u) => u());
        listenersRef.current.delete(id);
        lastActivityRef.current.delete(id);
        notifiedSessions.delete(id);
      }
    }
  }, [sessions]);

  // Periodic status check — every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const { sessions, updateStatus } = useSessionStore.getState();

      for (const session of sessions) {
        // Skip ghosts and terminal states
        if (session.isGhost) continue;
        if (session.status === 'done' || session.status === 'error') continue;

        const lastActivity = lastActivityRef.current.get(session.id);
        if (!lastActivity) continue;

        const elapsed = now - lastActivity;
        let newStatus: SessionStatus;

        if (elapsed < 3000) {
          newStatus = 'running';
        } else if (elapsed < 10000) {
          newStatus = 'idle';
        } else {
          newStatus = 'active'; // needs input
        }

        if (session.status !== newStatus) {
          updateStatus(session.id, newStatus);

          // Send notification when session needs input
          if (newStatus === 'active') {
            const enabled = useSettingsStore.getState().notificationsEnabled;
            if (enabled && notifiedSessions.get(session.id) !== 'active') {
              notifiedSessions.set(session.id, 'active');
              sendNotification(
                'Session Needs Input',
                `${session.label} (${session.tool === 'claude' ? 'Claude Code' : 'Codex'}) is waiting for your input`
              );
            }
          } else {
            // Clear notification dedup when status changes away from active
            notifiedSessions.delete(session.id);
          }
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Cleanup all listeners on unmount
  useEffect(() => {
    return () => {
      for (const unlistens of listenersRef.current.values()) {
        unlistens.forEach((u) => u());
      }
      listenersRef.current.clear();
      lastActivityRef.current.clear();
      notifiedSessions.clear();
    };
  }, []);
}
