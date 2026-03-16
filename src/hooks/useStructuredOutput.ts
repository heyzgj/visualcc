import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore } from '../stores/sessionStore';
import { claudeAdapter } from '../adapters/claudeAdapter';
import { codexAdapter } from '../adapters/codexAdapter';
import type { ToolType } from '../types/session';
import type { ToolAdapter } from '../adapters/types';

interface LinePayload {
  id: string;
  line: string;
}

const PARSE_ERROR_THRESHOLD = 5;

function getAdapter(tool: ToolType): ToolAdapter {
  return tool === 'claude' ? claudeAdapter : codexAdapter;
}

export function useStructuredOutput(sessionId: string, tool: ToolType) {
  const unlistenLineRef = useRef<UnlistenFn | null>(null);
  const unlistenStderrRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    const adapter = getAdapter(tool);

    const setupLine = async () => {
      const unlisten = await listen<LinePayload>(
        `session:line:${sessionId}`,
        (event) => {
          if (cancelled) return;

          const parsed = adapter.parseLine(event.payload.line);
          if (parsed) {
            useSessionStore.getState().resetParseErrors(sessionId);
            useSessionStore.getState().addMessage(sessionId, parsed);

            // Update status based on event type
            if (parsed.type === 'result') {
              useSessionStore.getState().updateStatus(
                sessionId,
                parsed.subtype === 'error' ? 'error' : 'done'
              );
            }
          } else {
            // Parse failed — count consecutive failures
            useSessionStore.getState().incrementParseErrors(sessionId);
            const errors = useSessionStore.getState().parseErrors[sessionId] ?? 0;
            if (errors >= PARSE_ERROR_THRESHOLD) {
              // Auto-fallback to terminal mode
              useSessionStore.getState().setRenderMode(sessionId, 'terminal');
            }
          }
        }
      );

      if (cancelled) {
        unlisten();
      } else {
        unlistenLineRef.current = unlisten;
      }
    };

    const setupStderr = async () => {
      const unlisten = await listen<LinePayload>(
        `session:stderr:${sessionId}`,
        (event) => {
          if (cancelled) return;

          const stderrEvent = adapter.parseStderr(event.payload.line);
          if (stderrEvent && stderrEvent.level === 'error') {
            // Add error as a system message
            useSessionStore.getState().addMessage(sessionId, {
              type: 'system',
              message: `stderr: ${stderrEvent.message}`,
              _raw: event.payload.line,
            });
          }
        }
      );

      if (cancelled) {
        unlisten();
      } else {
        unlistenStderrRef.current = unlisten;
      }
    };

    // Listen to status events
    const setupStatus = async () => {
      const unlisten = await listen<string>(
        `session:status:${sessionId}`,
        (event) => {
          if (cancelled) return;
          const status = event.payload as 'done' | 'error';
          useSessionStore.getState().updateStatus(sessionId, status);
        }
      );

      if (cancelled) {
        unlisten();
      }
      // We don't store this unlisten since the component will unmount
    };

    setupLine();
    setupStderr();
    setupStatus();

    return () => {
      cancelled = true;
      if (unlistenLineRef.current) {
        unlistenLineRef.current();
        unlistenLineRef.current = null;
      }
      if (unlistenStderrRef.current) {
        unlistenStderrRef.current();
        unlistenStderrRef.current = null;
      }
    };
  }, [sessionId, tool]);
}
