import { useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../stores/sessionStore';
import type { SessionEvent } from './useSessionEvents';
import {
  REVIEWER_CLAUDE_MD,
  buildReviewerInitPrompt,
  buildCatchUpPrompt,
} from '../templates/reviewer-prompt';

const RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Manages the Reviewer session lifecycle.
 * The Reviewer is a regular Claude Code session running in ~/.clockwork/
 * that acts as the owner's proxy for decision-making.
 */
export function useReviewerSession() {
  const isProcessingRef = useRef(false);
  const eventQueueRef = useRef<SessionEvent[]>([]);
  const isPausedRef = useRef(false);
  const responseResolverRef = useRef<(() => void) | null>(null);

  /**
   * Create the ~/.clockwork/ directory structure and CLAUDE.md,
   * then spawn a Claude Code session there.
   */
  const startReviewer = useCallback(async () => {
    try {
      // Resolve home directory
      const homeDir = await resolveHome();
      const clockworkPath = `${homeDir}/.clockwork`;

      // Create directory structure
      await createClockworkDirs(clockworkPath);

      // Write CLAUDE.md
      await writeClockworkFile(clockworkPath, 'CLAUDE.md', REVIEWER_CLAUDE_MD);

      // Create a Claude Code session at ~/.clockwork/
      const id = await invoke<string>('create_session', {
        tool: 'claude',
        cwd: clockworkPath,
        initialPrompt: null,
      });

      // Register reviewer session ID (not added to sessions list for canvas)
      useSessionStore.getState().setReviewerSessionId(id);

      // Wait for session to boot
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Send init prompt with workspace context
      const workers = useSessionStore.getState().sessions.filter(
        (s) => !s.isGhost && s.id !== id
      );
      const initPrompt = buildReviewerInitPrompt(workers);
      await writeToReviewer(id, initPrompt);
    } catch (err) {
      console.error('Failed to start Reviewer:', err);
      throw err;
    }
  }, []);

  /**
   * Stop routing events but keep session alive.
   */
  const pauseReviewer = useCallback(() => {
    isPausedRef.current = true;
  }, []);

  /**
   * Resume routing. Sends a catch-up summary.
   */
  const resumeReviewer = useCallback(async () => {
    isPausedRef.current = false;
    const reviewerSessionId = useSessionStore.getState().reviewerSessionId;
    if (!reviewerSessionId) return;

    const events = useSessionStore.getState().founderEventLog;
    const catchUpPrompt = buildCatchUpPrompt(events);
    await writeToReviewer(reviewerSessionId, catchUpPrompt);
  }, []);

  /**
   * Route a session event to the Reviewer.
   * Events are queued and processed serially.
   */
  const routeEvent = useCallback((event: SessionEvent) => {
    if (isPausedRef.current) return;

    eventQueueRef.current.push(event);
    if (!isProcessingRef.current) {
      processNext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Process the next queued event.
   */
  async function processNext() {
    if (eventQueueRef.current.length === 0) {
      isProcessingRef.current = false;
      return;
    }

    isProcessingRef.current = true;
    const event = eventQueueRef.current.shift()!;

    const reviewerSessionId = useSessionStore.getState().reviewerSessionId;
    if (!reviewerSessionId) {
      isProcessingRef.current = false;
      return;
    }

    try {
      const message = formatEventForReviewer(event);
      await writeToReviewer(reviewerSessionId, message);

      // Wait for response file or timeout
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          responseResolverRef.current = null;
          resolve();
        }, RESPONSE_TIMEOUT_MS);

        responseResolverRef.current = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    } catch (err) {
      console.error('Error routing event to reviewer:', err);
    }

    processNext();
  }

  /**
   * Signal that the Reviewer has responded.
   * Called by useClockwork when it detects a new outbox/ or cards/ file.
   */
  const signalResponse = useCallback(() => {
    if (responseResolverRef.current) {
      responseResolverRef.current();
      responseResolverRef.current = null;
    }
  }, []);

  return {
    startReviewer,
    pauseReviewer,
    resumeReviewer,
    routeEvent,
    signalResponse,
  };
}

// --- Helpers ---

function formatEventForReviewer(event: SessionEvent): string {
  const session = useSessionStore.getState().sessions.find(
    (s) => s.id === event.sessionId
  );
  const label = session?.label ?? event.sessionId;
  const toolLabel = session?.tool === 'claude' ? 'claude-code' : 'codex';
  const cwd = session?.cwd ?? 'unknown';

  switch (event.type) {
    case 'blocked': {
      const lastLine = event.lastLines[event.lastLines.length - 1] ?? '';
      return [
        `[${label}] blocked -- awaiting decision`,
        `Task: ${toolLabel} @ ${cwd}`,
        `Last output: "${lastLine}"`,
        `Status: idle for ${event.idleSeconds} seconds`,
        '',
      ].join('\n');
    }
    case 'completed': {
      const lastLine = event.lastLines[event.lastLines.length - 1] ?? '';
      return [
        `[${label}] completed`,
        `Task: ${toolLabel} @ ${cwd}`,
        `Last output: "${lastLine}"`,
        '',
      ].join('\n');
    }
    case 'errored':
      return [
        `[${label}] errored`,
        `Task: ${toolLabel} @ ${cwd}`,
        `Error: "${event.error.slice(0, 200)}"`,
        '',
      ].join('\n');
    case 'resumed':
      return [
        `[${label}] resumed -- back to work`,
        `Task: ${toolLabel} @ ${cwd}`,
        '',
      ].join('\n');
  }
}

async function writeToReviewer(sessionId: string, message: string): Promise<void> {
  try {
    await invoke('write_to_session', { id: sessionId, data: message + '\n' });
  } catch (err) {
    console.error('Failed to write to reviewer session:', err);
  }
}

async function resolveHome(): Promise<string> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    // Remove trailing slash if present
    return home.endsWith('/') ? home.slice(0, -1) : home;
  } catch {
    return '/tmp';
  }
}

async function createClockworkDirs(basePath: string): Promise<void> {
  try {
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const dirExists = await exists(basePath);
    if (!dirExists) {
      await mkdir(basePath, { recursive: true });
    }
    const outboxExists = await exists(`${basePath}/outbox`);
    if (!outboxExists) {
      await mkdir(`${basePath}/outbox`, { recursive: true });
    }
    const cardsExists = await exists(`${basePath}/cards`);
    if (!cardsExists) {
      await mkdir(`${basePath}/cards`, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create clockwork dirs:', err);
  }
}

async function writeClockworkFile(basePath: string, filename: string, content: string): Promise<void> {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(`${basePath}/${filename}`, content);
  } catch (err) {
    console.error('Failed to write clockwork file:', err);
  }
}
