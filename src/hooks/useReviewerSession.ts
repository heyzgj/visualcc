import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../stores/sessionStore';
import type { SessionEvent } from './useSessionEvents';
import {
  REVIEWER_CLAUDE_MD,
  buildReviewerInitPrompt,
  buildCatchUpPrompt,
} from '../templates/reviewer-prompt';

const RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes

const reviewerRuntime: {
  isProcessing: boolean;
  eventQueue: SessionEvent[];
  isPaused: boolean;
  responseResolver: (() => void) | null;
} = {
  isProcessing: false,
  eventQueue: [],
  isPaused: false,
  responseResolver: null,
};

/**
 * Manages the Reviewer session lifecycle.
 * The Reviewer is a regular Claude Code session running in ~/.clockwork/
 * that acts as the owner's proxy for decision-making.
 */
export function useReviewerSession() {
  /**
   * Create the ~/.clockwork/ directory structure and CLAUDE.md,
   * then spawn a Claude Code session there.
   */
  const startReviewer = useCallback(async () => {
    try {
      const clockworkPath = await invoke<string>('prepare_reviewer_workspace', {
        claudeMd: REVIEWER_CLAUDE_MD,
      });

      // Create a Claude Code session at ~/.clockwork/
      const id = await invoke<string>('create_session', {
        tool: 'claude',
        cwd: clockworkPath,
        initialPrompt: null,
      });

      // Register reviewer session ID (not added to sessions list for canvas)
      useSessionStore.getState().setReviewerSessionId(id);
      reviewerRuntime.isPaused = false;

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
    reviewerRuntime.isPaused = true;
  }, []);

  /**
   * Resume routing. Sends a catch-up summary.
   */
  const resumeReviewer = useCallback(async () => {
    reviewerRuntime.isPaused = false;
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
    if (reviewerRuntime.isPaused) return;

    reviewerRuntime.eventQueue.push(event);
    if (!reviewerRuntime.isProcessing) {
      processNext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Process the next queued event.
   */
  async function processNext() {
    if (reviewerRuntime.eventQueue.length === 0) {
      reviewerRuntime.isProcessing = false;
      return;
    }

    reviewerRuntime.isProcessing = true;
    const event = reviewerRuntime.eventQueue.shift()!;

    const reviewerSessionId = useSessionStore.getState().reviewerSessionId;
    if (!reviewerSessionId) {
      reviewerRuntime.isProcessing = false;
      return;
    }

    try {
      const message = formatEventForReviewer(event);
      await writeToReviewer(reviewerSessionId, message);

      // Wait for response file or timeout
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          reviewerRuntime.responseResolver = null;
          resolve();
        }, RESPONSE_TIMEOUT_MS);

        reviewerRuntime.responseResolver = () => {
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
    if (reviewerRuntime.responseResolver) {
      reviewerRuntime.responseResolver();
      reviewerRuntime.responseResolver = null;
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
