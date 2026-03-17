import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore } from '../stores/sessionStore';
import type { QuestionInfo } from '../types/session';

interface PtyOutputPayload {
  id: string;
  data: number[];
}

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')        // OSC sequences (title, etc.)
    .replace(/\x1b\([A-Z]/g, '')               // Character set selection
    .replace(/\x1b[>=<]/g, '')                  // Keypad modes
    .replace(/\r/g, '');                         // Carriage returns
}

// Detect localhost dev server URLs
const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/;

// Detect Y/n style questions
const YN_REGEX = /\(Y\/n\)|\(y\/N\)|\[Y\/n\]|\[y\/N\]|\(yes\/no\)/i;

// Detect permission/approval prompts
const PERMISSION_REGEX = /\bAllow\b|\bPermission\b|\bapprove\b|\bAccept\b|\bproceed\b.*\?/i;

// Per-session intelligence state (not in React state — too frequent)
interface IntelBuffer {
  lines: string[];           // Last 50 stripped lines
  rawAccum: string;          // Partial line accumulator (PTY sends chunks)
  lastActivity: string;
  detectedUrl: string | null;
  pendingQuestion: QuestionInfo | null;
}

const MAX_LINES = 50;

/**
 * Global hook: parses PTY output for all sessions to extract
 * smart subtitles, auto-detected preview URLs, and pending questions.
 * Updates sessionStore.sessionIntel with parsed intelligence.
 */
export function useOutputIntelligence() {
  const sessions = useSessionStore((s) => s.sessions);
  const buffersRef = useRef<Map<string, IntelBuffer>>(new Map());
  const listenersRef = useRef<Map<string, UnlistenFn>>(new Map());
  const updateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    // Add listeners for new sessions (skip ghosts)
    for (const session of sessions) {
      if (session.isGhost) continue;
      if (listenersRef.current.has(session.id)) continue;

      // Initialize buffer
      buffersRef.current.set(session.id, {
        lines: [],
        rawAccum: '',
        lastActivity: '',
        detectedUrl: session.previewUrl || null,  // Use configured URL as initial
        pendingQuestion: null,
      });

      // Listen to PTY output
      listen<PtyOutputPayload>(`session:output:${session.id}`, (event) => {
        const buf = buffersRef.current.get(session.id);
        if (!buf) return;

        // Decode bytes to string
        const text = new TextDecoder().decode(new Uint8Array(event.payload.data));
        buf.rawAccum += text;

        // Split into lines
        const parts = buf.rawAccum.split('\n');
        buf.rawAccum = parts.pop() ?? '';  // Keep incomplete last line

        for (const part of parts) {
          const stripped = stripAnsi(part).trim();
          if (!stripped) continue;

          buf.lines.push(stripped);
          if (buf.lines.length > MAX_LINES) {
            buf.lines.shift();
          }

          // Update last activity (smart subtitle)
          buf.lastActivity = stripped;

          // Detect dev server URL
          const urlMatch = stripped.match(URL_REGEX);
          if (urlMatch && !buf.detectedUrl) {
            buf.detectedUrl = urlMatch[0].replace(/\/$/, '');
          }

          // Clear any pending question (new output = question was answered)
          if (buf.pendingQuestion) {
            buf.pendingQuestion = null;
          }

          // Detect questions
          if (YN_REGEX.test(stripped)) {
            buf.pendingQuestion = {
              text: stripped,
              type: 'yn',
              detectedAt: Date.now(),
            };
          } else if (PERMISSION_REGEX.test(stripped)) {
            buf.pendingQuestion = {
              text: stripped,
              type: 'permission',
              detectedAt: Date.now(),
            };
          }
        }

        // Also check the partial accumulated line for questions
        const partialStripped = stripAnsi(buf.rawAccum).trim();
        if (partialStripped) {
          buf.lastActivity = partialStripped;

          if (YN_REGEX.test(partialStripped)) {
            buf.pendingQuestion = {
              text: partialStripped,
              type: 'yn',
              detectedAt: Date.now(),
            };
          } else if (PERMISSION_REGEX.test(partialStripped)) {
            buf.pendingQuestion = {
              text: partialStripped,
              type: 'permission',
              detectedAt: Date.now(),
            };
          }
        }

        // Debounced update to store (200ms)
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
      }).then((unlisten) => {
        listenersRef.current.set(session.id, unlisten);
      });
    }

    // Cleanup removed sessions
    for (const [id] of listenersRef.current) {
      if (!currentIds.has(id)) {
        listenersRef.current.get(id)?.();
        listenersRef.current.delete(id);
        buffersRef.current.delete(id);
        const timer = updateTimersRef.current.get(id);
        if (timer) clearTimeout(timer);
        updateTimersRef.current.delete(id);
      }
    }
  }, [sessions]);

  // Detect open-ended questions when session becomes 'active' (>10s idle)
  useEffect(() => {
    const interval = setInterval(() => {
      const { sessions } = useSessionStore.getState();
      for (const session of sessions) {
        if (session.isGhost) continue;
        if (session.status !== 'active') continue;

        const buf = buffersRef.current.get(session.id);
        if (!buf || buf.pendingQuestion) continue;

        // If last activity ends with '?' and we're in 'active' status, surface it
        if (buf.lastActivity.endsWith('?')) {
          buf.pendingQuestion = {
            text: buf.lastActivity,
            type: 'open',
            detectedAt: Date.now(),
          };
          useSessionStore.getState().updateIntel(session.id, {
            pendingQuestion: buf.pendingQuestion,
          });
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Generate outcome on session completion
  useEffect(() => {
    const { sessions } = useSessionStore.getState();
    for (const session of sessions) {
      if (session.isGhost) continue;
      if (session.status !== 'done' && session.status !== 'error') continue;

      const intel = useSessionStore.getState().sessionIntel[session.id];
      if (intel?.outcome) continue;  // Already has outcome

      const buf = buffersRef.current.get(session.id);
      if (!buf) continue;

      // Parse last lines for outcome summary
      const lastLines = buf.lines.slice(-10);
      let summary = session.status === 'error' ? 'Session ended with error' : 'Session completed';
      let filesChanged: number | undefined;

      // Look for common patterns
      for (const line of lastLines) {
        const filesMatch = line.match(/(\d+)\s+files?\s+changed/i);
        if (filesMatch) filesChanged = parseInt(filesMatch[1]);

        const testMatch = line.match(/(\d+)\s+(?:tests?\s+)?pass/i);
        if (testMatch) summary = `${testMatch[0]}`;

        if (line.match(/all\s+tests?\s+pass/i)) {
          summary = line;
        }
      }

      if (filesChanged) {
        summary = `${filesChanged} file${filesChanged > 1 ? 's' : ''} changed · ${summary}`;
      }

      const duration = Date.now() - session.created_at;
      useSessionStore.getState().updateIntel(session.id, {
        outcome: { summary, filesChanged, duration },
        pendingQuestion: null,
      });
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const unlisten of listenersRef.current.values()) {
        unlisten();
      }
      listenersRef.current.clear();
      buffersRef.current.clear();
      for (const timer of updateTimersRef.current.values()) {
        clearTimeout(timer);
      }
      updateTimersRef.current.clear();
    };
  }, []);
}
