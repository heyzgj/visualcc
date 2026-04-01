import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore, getSessionEventCallback } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { SessionStatus, QuestionInfo } from '../types/session';
import {
  URL_REGEX,
  BUILD_PATTERNS,
  ERROR_PATTERNS,
  detectPendingQuestion,
} from '../utils/sessionPromptDetection';

// --- Event Types ---

export type SessionEvent =
  | { type: 'blocked'; sessionId: string; lastLines: string[]; idleSeconds: number }
  | { type: 'completed'; sessionId: string; lastLines: string[] }
  | { type: 'errored'; sessionId: string; error: string }
  | { type: 'resumed'; sessionId: string };

export type EventCallback = (event: SessionEvent) => void;

// --- ANSI stripping (reused from useOutputIntelligence) ---

function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')        // OSC sequences (title, etc.)
    .replace(/\x1b\([A-Z]/g, '')               // Character set selection
    .replace(/\x1b[>=<]/g, '')                  // Keypad modes
    .replace(/\r/g, '');                         // Carriage returns
}

// --- Per-session buffer ---

interface SessionBuffer {
  lines: string[];           // Last 50 stripped lines
  rawAccum: string;          // Partial line accumulator
  lastActivity: string;      // Smart subtitle text
  lastOutputTime: number;    // Timestamp of last output
  detectedUrl: string | null;
  pendingQuestion: QuestionInfo | null;
  wasBlocked: boolean;       // Whether we already fired 'blocked' for current idle period
}

const MAX_LINES = 50;
const IDLE_THRESHOLD_MS = 60_000;  // 60 seconds for idle-based blocking

// --- Notification helpers (reused from useStatusDetector) ---

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
    // Notifications not available
  }
}

// --- PTY output payload ---

interface PtyOutputPayload {
  id: string;
  data: number[];
}

/**
 * Unified session event detection hook.
 * Replaces useStatusDetector + useOutputIntelligence.
 *
 * Detects: blocked, completed, errored, resumed events.
 * Updates session status and intel in the store.
 * Fires EventCallback for Vacation Mode routing.
 */
export function useSessionEvents() {
  const sessions = useSessionStore((s) => s.sessions);
  const buffersRef = useRef<Map<string, SessionBuffer>>(new Map());
  const listenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  const updateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Setup/teardown event listeners per session
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    for (const session of sessions) {
      if (session.isGhost) continue;
      if (listenersRef.current.has(session.id)) continue;

      // Initialize buffer
      buffersRef.current.set(session.id, {
        lines: [],
        rawAccum: '',
        lastActivity: '',
        lastOutputTime: Date.now(),
        detectedUrl: session.previewUrl || null,
        pendingQuestion: null,
        wasBlocked: false,
      });

      const unlistens: UnlistenFn[] = [];
      listenersRef.current.set(session.id, unlistens);

      // Listen to PTY output
      listen<PtyOutputPayload>(`session:output:${session.id}`, (event) => {
        const buf = buffersRef.current.get(session.id);
        if (!buf) return;

        buf.lastOutputTime = Date.now();

        // If was blocked and now producing output, fire 'resumed'
        if (buf.wasBlocked) {
          buf.wasBlocked = false;
          const callback = getSessionEventCallback();
          if (callback) {
            callback({ type: 'resumed', sessionId: session.id });
          }
        }

        // Decode bytes to string
        const text = new TextDecoder().decode(new Uint8Array(event.payload.data));
        buf.rawAccum += text;

        // Split into lines
        const parts = buf.rawAccum.split('\n');
        buf.rawAccum = parts.pop() ?? '';

        for (const part of parts) {
          const stripped = stripAnsi(part).trim();
          if (!stripped) continue;

          buf.lines.push(stripped);
          if (buf.lines.length > MAX_LINES) {
            buf.lines.shift();
          }

          buf.lastActivity = stripped;

          // Detect dev server URL
          const urlMatch = stripped.match(URL_REGEX);
          if (urlMatch && !buf.detectedUrl) {
            buf.detectedUrl = urlMatch[0].replace(/\/$/, '');
          }

          // Detect errors in output
          if (ERROR_PATTERNS.test(stripped)) {
            const callback = getSessionEventCallback();
            if (callback) {
              callback({ type: 'errored', sessionId: session.id, error: stripped });
            }
          }
        }

        // Re-evaluate prompt state after ingesting the current chunk so
        // partial-screen prompts (Codex update/trust dialogs, tmux prompts)
        // can still surface as Needs Input without waiting for a newline.
        const partialStripped = stripAnsi(buf.rawAccum).trim();
        if (partialStripped) {
          buf.lastActivity = partialStripped;
        }

        buf.pendingQuestion = null;
        const pendingQuestion = detectPendingQuestion({
          recentLines: buf.lines,
          partialLine: partialStripped,
        });

        if (pendingQuestion) {
          buf.pendingQuestion = pendingQuestion;
          useSessionStore.getState().updateStatus(session.id, 'active');
          fireBlockedEvent(session.id, buf);
        }

        // Debounced update to store
        const existingTimer = updateTimersRef.current.get(session.id);
        if (existingTimer) clearTimeout(existingTimer);
        updateTimersRef.current.set(
          session.id,
          setTimeout(() => {
            const b = buffersRef.current.get(session.id);
            if (!b) return;
            useSessionStore.getState().updateIntel(session.id, {
              lastActivity: b.lastActivity,
              detectedUrl: b.detectedUrl,
              pendingQuestion: b.pendingQuestion,
            });
          }, 200)
        );
      }).then((u) => unlistens.push(u));

      // Backend status events (process exit)
      listen<string>(`session:status:${session.id}`, (event) => {
        const payload = event.payload;
        if (payload === 'done' || payload === 'error') {
          useSessionStore.getState().updateStatus(session.id, payload as SessionStatus);

          const buf = buffersRef.current.get(session.id);
          const lastLines = buf?.lines.slice(-10) ?? [];

          // Fire event
          const callback = getSessionEventCallback();
          if (callback) {
            if (payload === 'done') {
              callback({ type: 'completed', sessionId: session.id, lastLines });
            } else {
              callback({ type: 'errored', sessionId: session.id, error: lastLines.join('\n') });
            }
          }

          // Generate outcome
          if (buf) {
            let summary = payload === 'error' ? 'Session ended with error' : 'Session completed';
            let filesChanged: number | undefined;
            for (const line of lastLines) {
              const filesMatch = line.match(/(\d+)\s+files?\s+changed/i);
              if (filesMatch) filesChanged = parseInt(filesMatch[1]);
              const testMatch = line.match(/(\d+)\s+(?:tests?\s+)?pass/i);
              if (testMatch) summary = `${testMatch[0]}`;
              if (line.match(/all\s+tests?\s+pass/i)) summary = line;
            }
            if (filesChanged) {
              summary = `${filesChanged} file${filesChanged > 1 ? 's' : ''} changed -- ${summary}`;
            }
            const duration = Date.now() - session.created_at;
            useSessionStore.getState().updateIntel(session.id, {
              outcome: { summary, filesChanged, duration },
              pendingQuestion: null,
            });
          }

          // OS notification on error
          if (payload === 'error') {
            const enabled = useSettingsStore.getState().notificationsEnabled;
            if (enabled && notifiedSessions.get(session.id) !== 'error') {
              notifiedSessions.set(session.id, 'error');
              const toolLabel = session.tool === 'claude' ? 'Claude Code' : 'Codex';
              sendNotification('Session Error', `${session.label} (${toolLabel}) exited with an error`);
            }
          }
        }
      }).then((u) => unlistens.push(u));
    }

    // Cleanup removed sessions
    for (const [id, unlistens] of listenersRef.current) {
      if (!currentIds.has(id)) {
        unlistens.forEach((u) => u());
        listenersRef.current.delete(id);
        buffersRef.current.delete(id);
        notifiedSessions.delete(id);
        const timer = updateTimersRef.current.get(id);
        if (timer) clearTimeout(timer);
        updateTimersRef.current.delete(id);
      }
    }
  }, [sessions]);

  // Periodic status check (every 2s) — handles idle-based detection + status updates
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const { sessions, updateStatus } = useSessionStore.getState();

      for (const session of sessions) {
        if (session.isGhost) continue;
        if (session.status === 'done' || session.status === 'error') continue;

        const buf = buffersRef.current.get(session.id);
        if (!buf) continue;

        const elapsed = now - buf.lastOutputTime;
        let newStatus: SessionStatus;

        // Only two time-based states: running (recent output) and idle (no output)
        // 'active' (needs input) is ONLY set by actual prompt detection (Y/n, permissions)
        // not by idle time — after a turn ends, Claude is just idle, not "needing input"
        if (elapsed < 3000) {
          newStatus = 'running';
        } else {
          newStatus = 'idle';
        }

        // If there's a pending question detected from output patterns, mark as 'active'
        if (buf.pendingQuestion && newStatus === 'idle') {
          newStatus = 'active';
        }

        if (session.status !== newStatus) {
          updateStatus(session.id, newStatus);

          // Notification on 'active' (actual needs input, not time-based)
          if (newStatus === 'active') {
            const enabled = useSettingsStore.getState().notificationsEnabled;
            if (enabled && notifiedSessions.get(session.id) !== 'active') {
              notifiedSessions.set(session.id, 'active');
              const toolLabel = session.tool === 'claude' ? 'Claude Code' : 'Codex';
              sendNotification('Session Needs Input', `${session.label} (${toolLabel}) is waiting for your input`);
            }
          } else {
            notifiedSessions.delete(session.id);
          }
        }

        // Long idle check for 'blocked' event (60s, compound trigger)
        if (elapsed >= IDLE_THRESHOLD_MS && !buf.wasBlocked) {
          const lastLine = buf.lastActivity;
          // Only fire if last output is NOT a build/install pattern
          if (lastLine && !BUILD_PATTERNS.test(lastLine)) {
            fireBlockedEvent(session.id, buf);
          }
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const unlistens of listenersRef.current.values()) {
        unlistens.forEach((u) => u());
      }
      listenersRef.current.clear();
      buffersRef.current.clear();
      for (const timer of updateTimersRef.current.values()) {
        clearTimeout(timer);
      }
      updateTimersRef.current.clear();
      notifiedSessions.clear();
    };
  }, []);
}

// --- Helper: fire blocked event ---

function fireBlockedEvent(sessionId: string, buf: SessionBuffer) {
  if (buf.wasBlocked) return;  // Already fired for this idle period
  buf.wasBlocked = true;

  const idleSeconds = Math.floor((Date.now() - buf.lastOutputTime) / 1000);
  const callback = getSessionEventCallback();
  if (callback) {
    callback({
      type: 'blocked',
      sessionId,
      lastLines: buf.lines.slice(-5),
      idleSeconds,
    });
  }
}
