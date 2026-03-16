import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore } from '../stores/sessionStore';
import type { SessionStatus } from '../types/session';

/**
 * Global hook: listens to PTY output events for all sessions,
 * tracks activity timestamps, and updates session status accordingly.
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

    // Add listeners for new sessions
    for (const session of sessions) {
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
        }
      }).then((u) => unlistens.push(u));
    }

    // Cleanup listeners for removed sessions
    for (const [id, unlistens] of listenersRef.current) {
      if (!currentIds.has(id)) {
        unlistens.forEach((u) => u());
        listenersRef.current.delete(id);
        lastActivityRef.current.delete(id);
      }
    }
  }, [sessions]);

  // Periodic status check — every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const { sessions, updateStatus } = useSessionStore.getState();

      for (const session of sessions) {
        // Don't override terminal states
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
    };
  }, []);
}
