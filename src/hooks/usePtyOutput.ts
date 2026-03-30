import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Terminal } from '@xterm/xterm';

interface PtyOutputPayload {
  id: string;
  data: number[];
}

/**
 * Listens to PTY output events for a session and writes to an xterm.js terminal.
 *
 * Key design: starts listening as soon as sessionId is provided, even before
 * the Terminal instance exists. Buffers any early output and replays it once
 * the terminal becomes available. This prevents losing the initial output
 * (e.g. Claude Code welcome screen) that arrives between session creation
 * and terminal mounting.
 */
export function usePtyOutput(sessionId: string, terminal: Terminal | null) {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const bufferRef = useRef<Uint8Array[]>([]);
  const terminalRef = useRef<Terminal | null>(null);

  // Track terminal ref changes
  terminalRef.current = terminal;

  // Start listening as soon as we have a sessionId (even without terminal)
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    bufferRef.current = []; // Reset buffer for new session

    const setup = async () => {
      const unlisten = await listen<PtyOutputPayload>(
        `session:output:${sessionId}`,
        (event) => {
          if (cancelled) return;
          const bytes = new Uint8Array(event.payload.data);

          if (terminalRef.current) {
            // Terminal exists, write directly
            terminalRef.current.write(bytes);
          } else {
            // Terminal not ready yet, buffer the data
            bufferRef.current.push(bytes);
          }
        }
      );

      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      bufferRef.current = [];
    };
  }, [sessionId]);

  // When terminal becomes available, replay any buffered output
  useEffect(() => {
    if (!terminal || bufferRef.current.length === 0) return;

    // Replay all buffered data
    for (const chunk of bufferRef.current) {
      terminal.write(chunk);
    }
    bufferRef.current = [];
  }, [terminal]);
}
