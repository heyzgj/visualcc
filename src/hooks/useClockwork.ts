import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../stores/sessionStore';
import { useCardStore, type DecisionCard } from '../stores/cardStore';
import type { SessionEvent } from './useSessionEvents';

const HISTORY_FILE = 'history.jsonl';
const CIRCUIT_BREAKER_WINDOW_MS = 600_000; // 10 minutes
const CIRCUIT_BREAKER_THRESHOLD = 3;
const RESOLUTION_COOLDOWN_MS = 60_000; // 60 seconds of working = reset circuit

// --- Outbox JSON shape ---
interface OutboxEntry {
  sessionId: string;
  instruction: string | null;
  note?: string;
}

// --- Card JSON shape ---
interface CardEntry {
  sessionId: string;
  project: string;
  title: string;
  context: string;
  options: Array<{ label: string; description: string; recommended: boolean }>;
  recommendReasoning: string;
  isTasteDecision: boolean;
}

// --- Defensive JSON parsing ---
function parseClockworkJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    // Try to extract a JSON object from the content
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Give up
      }
    }
    return null;
  }
}

/**
 * Watches ~/.clockwork/outbox/ and ~/.clockwork/cards/ for new files.
 * Processes outbox entries (send instructions to workers) and card entries
 * (surface Decision Cards to the owner).
 *
 * Also implements the Circuit Breaker (Phase 8F).
 */
export function useClockwork() {
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownOutboxFilesRef = useRef<Set<string>>(new Set());
  const knownCardFilesRef = useRef<Set<string>>(new Set());
  const clockworkPathRef = useRef<string | null>(null);

  // Circuit breaker state
  const blockHistoryRef = useRef<Record<string, number[]>>({});
  const resolutionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Signal callback for useReviewerSession
  const signalResolverRef = useRef<(() => void) | null>(null);

  /**
   * Set the signal callback (called by useReviewerSession).
   */
  const setSignalResolver = useCallback((resolver: (() => void) | null) => {
    signalResolverRef.current = resolver;
  }, []);

  // Initialize clockwork path + start polling
  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = await homeDir();
        const basePath = (home.endsWith('/') ? home.slice(0, -1) : home) + '/.clockwork';
        if (active) {
          clockworkPathRef.current = basePath;
        }
      } catch {
        clockworkPathRef.current = '/tmp/.clockwork';
      }
    }

    init();

    // Poll every 2 seconds for new files
    pollTimerRef.current = setInterval(() => {
      if (clockworkPathRef.current) {
        pollOutbox(clockworkPathRef.current);
        pollCards(clockworkPathRef.current);
      }
    }, 2000);

    return () => {
      active = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Poll outbox/ directory for new JSON files.
   */
  async function pollOutbox(basePath: string) {
    try {
      const { readDir, readTextFile, remove } = await import('@tauri-apps/plugin-fs');
      let entries;
      try {
        entries = await readDir(`${basePath}/outbox`);
      } catch {
        return; // Directory may not exist yet
      }

      for (const entry of entries) {
        if (!entry.name || !entry.name.endsWith('.json')) continue;
        if (knownOutboxFilesRef.current.has(entry.name)) continue;

        knownOutboxFilesRef.current.add(entry.name);

        try {
          const filePath = `${basePath}/outbox/${entry.name}`;
          const content = await readTextFile(filePath);
          const parsed = parseClockworkJson(content) as OutboxEntry | null;

          if (parsed && parsed.sessionId) {
            // If instruction is not null, send it to the worker
            if (parsed.instruction) {
              await invoke('write_to_session', {
                id: parsed.sessionId,
                data: parsed.instruction + '\n',
              });

              // Start resolution timer for circuit breaker
              startResolutionTimer(parsed.sessionId);
            }

            // Log to history
            await logToHistory(basePath, {
              ts: new Date().toISOString(),
              sessionId: parsed.sessionId,
              decision: parsed.instruction ?? parsed.note ?? 'no action',
              decidedBy: 'reviewer',
            });

            // Delete the file
            await remove(filePath);
            knownOutboxFilesRef.current.delete(entry.name);

            // Signal reviewer that processing is done
            if (signalResolverRef.current) {
              signalResolverRef.current();
            }
          }
        } catch (err) {
          console.error('Error processing outbox file:', entry.name, err);
        }
      }
    } catch (err) {
      console.error('Error polling outbox:', err);
    }
  }

  /**
   * Poll cards/ directory for new JSON files.
   */
  async function pollCards(basePath: string) {
    try {
      const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
      let entries;
      try {
        entries = await readDir(`${basePath}/cards`);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.name || !entry.name.endsWith('.json')) continue;
        if (knownCardFilesRef.current.has(entry.name)) continue;

        knownCardFilesRef.current.add(entry.name);

        try {
          const filePath = `${basePath}/cards/${entry.name}`;
          const content = await readTextFile(filePath);
          const parsed = parseClockworkJson(content) as CardEntry | null;

          if (parsed && parsed.sessionId) {
            // Add to card store
            const card: DecisionCard = {
              id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId: parsed.sessionId,
              project: parsed.project ?? 'Unknown',
              title: parsed.title ?? 'Decision needed',
              context: parsed.context ?? '',
              options: parsed.options ?? [],
              recommendReasoning: parsed.recommendReasoning ?? '',
              isTasteDecision: parsed.isTasteDecision ?? false,
              exchangeCount: 0,
              createdAt: Date.now(),
              filePath: filePath,
            };

            useCardStore.getState().addCard(card);

            // Signal reviewer that processing is done
            if (signalResolverRef.current) {
              signalResolverRef.current();
            }
          }
        } catch (err) {
          console.error('Error processing card file:', entry.name, err);
        }
      }
    } catch (err) {
      console.error('Error polling cards:', err);
    }
  }

  // --- Circuit Breaker (Phase 8F) ---

  /**
   * Record a 'blocked' event for circuit breaker tracking.
   */
  const recordBlock = useCallback((sessionId: string) => {
    if (!blockHistoryRef.current[sessionId]) {
      blockHistoryRef.current[sessionId] = [];
    }
    blockHistoryRef.current[sessionId].push(Date.now());

    // Clean entries older than the window
    blockHistoryRef.current[sessionId] = blockHistoryRef.current[sessionId].filter(
      (t) => Date.now() - t < CIRCUIT_BREAKER_WINDOW_MS
    );
  }, []);

  /**
   * Check if the circuit is broken (too many unresolved blocks).
   */
  const isCircuitBroken = useCallback((sessionId: string): boolean => {
    const history = blockHistoryRef.current[sessionId];
    if (!history) return false;

    // Clean old entries
    const recent = history.filter((t) => Date.now() - t < CIRCUIT_BREAKER_WINDOW_MS);
    blockHistoryRef.current[sessionId] = recent;

    return recent.length >= CIRCUIT_BREAKER_THRESHOLD;
  }, []);

  /**
   * Start a resolution timer: if the worker keeps working for 60s+
   * after receiving an instruction, reset the circuit breaker.
   */
  function startResolutionTimer(sessionId: string) {
    if (resolutionTimersRef.current[sessionId]) {
      clearTimeout(resolutionTimersRef.current[sessionId]);
    }

    resolutionTimersRef.current[sessionId] = setTimeout(() => {
      // Reset circuit breaker for this session
      blockHistoryRef.current[sessionId] = [];
      delete resolutionTimersRef.current[sessionId];
    }, RESOLUTION_COOLDOWN_MS);
  }

  /**
   * Generate a Decision Card directly to the owner (bypassing Reviewer).
   * Used when the circuit breaker fires.
   */
  const generateDirectCard = useCallback((event: SessionEvent) => {
    if (event.type !== 'blocked') return;

    const session = useSessionStore.getState().sessions.find(
      (s) => s.id === event.sessionId
    );
    const label = session?.label ?? event.sessionId;

    const card: DecisionCard = {
      id: `direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: event.sessionId,
      project: label,
      title: 'Worker stuck in loop',
      context: `${label} blocked ${CIRCUIT_BREAKER_THRESHOLD} times in ${CIRCUIT_BREAKER_WINDOW_MS / 60_000} minutes. Reviewer's instructions aren't resolving the issue.`,
      options: [
        { label: 'Switch to Founder Mode', description: 'Take direct control of this session', recommended: true },
        { label: 'Let Reviewer try again', description: 'Reset the circuit breaker and give the Reviewer another chance', recommended: false },
        { label: 'Stop this session', description: 'Kill this worker session', recommended: false },
      ],
      recommendReasoning: 'The Reviewer has failed to resolve this session multiple times. Direct intervention is recommended.',
      isTasteDecision: false,
      exchangeCount: 0,
      createdAt: Date.now(),
    };

    useCardStore.getState().addCard(card);
  }, []);

  /**
   * Get the count of reviewer-handled decisions today (from history.jsonl).
   */
  const getHandledCountToday = useCallback(async (): Promise<number> => {
    if (!clockworkPathRef.current) return 0;

    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(`${clockworkPathRef.current}/${HISTORY_FILE}`);
      const today = new Date().toISOString().split('T')[0];
      const lines = content.split('\n').filter((l) => l.trim());
      let count = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.ts && entry.ts.startsWith(today)) {
            count++;
          }
        } catch {
          // Skip malformed lines
        }
      }
      return count;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Resolve a card: send instruction to worker, delete file, log to history.
   */
  const resolveCard = useCallback(async (card: DecisionCard, instruction: string) => {
    // Send instruction to worker
    try {
      await invoke('write_to_session', {
        id: card.sessionId,
        data: instruction + '\n',
      });
    } catch (err) {
      console.error('Failed to send instruction to worker:', err);
    }

    // Delete the card file if it exists
    if (card.filePath) {
      try {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(card.filePath);
      } catch {
        // File may already be deleted
      }
    }

    // Log to history
    if (clockworkPathRef.current) {
      await logToHistory(clockworkPathRef.current, {
        ts: new Date().toISOString(),
        sessionId: card.sessionId,
        decision: instruction,
        decidedBy: 'owner',
        cardTitle: card.title,
      });
    }

    // Remove from card store
    useCardStore.getState().resolveCard(card.id);

    // Start resolution timer
    startResolutionTimer(card.sessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    recordBlock,
    isCircuitBroken,
    generateDirectCard,
    getHandledCountToday,
    resolveCard,
    setSignalResolver,
  };
}

// --- Helpers ---

async function logToHistory(
  basePath: string,
  entry: Record<string, unknown>
): Promise<void> {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    // Append to history file
    const line = JSON.stringify(entry) + '\n';
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const existing = await readTextFile(`${basePath}/${HISTORY_FILE}`);
      await writeTextFile(`${basePath}/${HISTORY_FILE}`, existing + line);
    } catch {
      // File doesn't exist, create it
      await writeTextFile(`${basePath}/${HISTORY_FILE}`, line);
    }
  } catch (err) {
    console.error('Failed to log to history:', err);
  }
}
