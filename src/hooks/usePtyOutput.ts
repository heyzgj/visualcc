import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Terminal } from '@xterm/xterm';

interface PtyOutputPayload {
  id: string;
  data: number[];
}

export function usePtyOutput(sessionId: string, terminal: Terminal | null) {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (!terminal) return;

    let cancelled = false;

    const setup = async () => {
      const unlisten = await listen<PtyOutputPayload>(
        `session:output:${sessionId}`,
        (event) => {
          if (!cancelled && terminal) {
            const bytes = new Uint8Array(event.payload.data);
            terminal.write(bytes);
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
    };
  }, [sessionId, terminal]);
}
