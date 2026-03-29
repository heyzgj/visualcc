import { create } from 'zustand';
import type { SessionInfo, ToolType, SessionStatus, SessionIntel } from '../types/session';
import type { ChatEvent, RenderMode } from '../adapters/types';
import type { EventCallback } from '../hooks/useSessionEvents';

export type AppMode = 'founder' | 'vacation';

export interface FounderEventLogEntry {
  ts: string;
  sessionId: string;
  event: string;
  detail: string;
}

const PERSIST_KEY = 'visualcc-sessions';
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedSession {
  tool: ToolType;
  cwd: string;
  label: string;
  position: { x: number; y: number };
  tileSize: { width: number; height: number };
  taskTitle?: string;
  previewUrl?: string;
}

function loadPersistedSessions(): SessionInfo[] {
  try {
    const saved = localStorage.getItem(PERSIST_KEY);
    if (!saved) return [];
    const items: PersistedSession[] = JSON.parse(saved);
    return items.map((item, i) => ({
      id: `ghost-${i}-${Date.now()}`,
      tool: item.tool,
      cwd: item.cwd,
      label: item.label,
      status: 'done' as SessionStatus,
      created_at: Date.now(),
      position: item.position,
      isGhost: true,
      taskTitle: item.taskTitle,
      previewUrl: item.previewUrl,
    }));
  } catch {
    return [];
  }
}

function persistSessions(sessions: SessionInfo[], tileSizes: Record<string, { width: number; height: number }>) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const live = sessions.filter((s) => !s.isGhost);
    if (live.length === 0 && sessions.filter((s) => s.isGhost).length > 0) {
      // Don't overwrite persisted data if we only have ghosts
      return;
    }
    const data: PersistedSession[] = live.map((s) => ({
      tool: s.tool,
      cwd: s.cwd,
      label: s.label,
      position: s.position,
      tileSize: tileSizes[s.id] ?? { width: 560, height: 420 },
      taskTitle: s.taskTitle,
      previewUrl: s.previewUrl,
    }));
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
  }, 500);
}

interface SessionStore {
  sessions: SessionInfo[];
  showNewDialog: boolean;
  messages: Record<string, ChatEvent[]>;
  renderModes: Record<string, RenderMode>;
  parseErrors: Record<string, number>;
  tileSizes: Record<string, { width: number; height: number }>;
  sessionIntel: Record<string, SessionIntel>;

  // Vacation Mode state
  mode: AppMode;
  reviewerSessionId: string | null;
  founderEventLog: FounderEventLogEntry[];
  onSessionEvent: EventCallback | null;

  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  removeGhost: (id: string) => void;
  relaunchGhost: (ghostId: string, newSession: SessionInfo) => void;
  updateStatus: (id: string, status: SessionStatus) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateTileSize: (id: string, width: number, height: number) => void;
  setShowNewDialog: (show: boolean) => void;
  addMessage: (id: string, event: ChatEvent) => void;
  setRenderMode: (id: string, mode: RenderMode) => void;
  incrementParseErrors: (id: string) => void;
  resetParseErrors: (id: string) => void;
  updateIntel: (id: string, intel: Partial<SessionIntel>) => void;

  // Vacation Mode actions
  setMode: (mode: AppMode) => void;
  setReviewerSessionId: (id: string | null) => void;
  addFounderEvent: (entry: FounderEventLogEntry) => void;
  clearFounderEventLog: () => void;
  setOnSessionEvent: (callback: EventCallback | null) => void;
}

// Load ghost tiles from localStorage on startup
const initialGhosts = loadPersistedSessions();
const initialTileSizes: Record<string, { width: number; height: number }> = {};
try {
  const saved = localStorage.getItem(PERSIST_KEY);
  if (saved) {
    const items: PersistedSession[] = JSON.parse(saved);
    initialGhosts.forEach((ghost, i) => {
      initialTileSizes[ghost.id] = items[i]?.tileSize ?? { width: 560, height: 420 };
    });
  }
} catch {}

export const useSessionStore = create<SessionStore>((set, _get) => ({
  sessions: initialGhosts,
  showNewDialog: false,
  messages: {},
  renderModes: {},
  parseErrors: {},
  tileSizes: initialTileSizes,
  sessionIntel: {},

  // Vacation Mode initial state
  mode: 'founder' as AppMode,
  reviewerSessionId: null,
  founderEventLog: [],
  onSessionEvent: null,

  addSession: (session) =>
    set((state) => {
      const next = {
        sessions: [...state.sessions, session],
        messages: { ...state.messages, [session.id]: [] as ChatEvent[] },
        renderModes: { ...state.renderModes, [session.id]: 'chat' as RenderMode },
        parseErrors: { ...state.parseErrors, [session.id]: 0 },
        tileSizes: { ...state.tileSizes, [session.id]: { width: 560, height: 420 } },
      };
      persistSessions(next.sessions, next.tileSizes);
      return next;
    }),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _msgs, ...restMessages } = state.messages;
      const { [id]: _mode, ...restModes } = state.renderModes;
      const { [id]: _errs, ...restErrors } = state.parseErrors;
      const { [id]: _size, ...restSizes } = state.tileSizes;
      const { [id]: _intel, ...restIntel } = state.sessionIntel;
      const next = {
        sessions: state.sessions.filter((s) => s.id !== id),
        messages: restMessages,
        renderModes: restModes,
        parseErrors: restErrors,
        tileSizes: restSizes,
        sessionIntel: restIntel,
      };
      persistSessions(next.sessions, next.tileSizes);
      return next;
    }),

  removeGhost: (id) =>
    set((state) => {
      const { [id]: _size, ...restSizes } = state.tileSizes;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        tileSizes: restSizes,
      };
    }),

  relaunchGhost: (ghostId, newSession) =>
    set((state) => {
      const ghost = state.sessions.find((s) => s.id === ghostId);
      const ghostTileSize = state.tileSizes[ghostId] ?? { width: 560, height: 420 };
      const { [ghostId]: _size, ...restSizes } = state.tileSizes;
      const next = {
        sessions: state.sessions
          .filter((s) => s.id !== ghostId)
          .concat({ ...newSession, position: ghost?.position ?? newSession.position }),
        messages: { ...state.messages, [newSession.id]: [] as ChatEvent[] },
        renderModes: { ...state.renderModes, [newSession.id]: 'terminal' as RenderMode },
        parseErrors: { ...state.parseErrors, [newSession.id]: 0 },
        tileSizes: { ...restSizes, [newSession.id]: ghostTileSize },
      };
      persistSessions(next.sessions, next.tileSizes);
      return next;
    }),

  updateStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  updatePosition: (id, x, y) =>
    set((state) => {
      const next = {
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, position: { x, y } } : s
        ),
      };
      persistSessions(next.sessions, state.tileSizes);
      return next;
    }),

  updateTileSize: (id, width, height) =>
    set((state) => {
      const next = {
        tileSizes: { ...state.tileSizes, [id]: { width, height } },
      };
      persistSessions(state.sessions, next.tileSizes);
      return next;
    }),

  setShowNewDialog: (show) => set({ showNewDialog: show }),

  addMessage: (id, event) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [id]: [...(state.messages[id] ?? []), event],
      },
    })),

  setRenderMode: (id, mode) =>
    set((state) => ({
      renderModes: { ...state.renderModes, [id]: mode },
    })),

  incrementParseErrors: (id) =>
    set((state) => ({
      parseErrors: {
        ...state.parseErrors,
        [id]: (state.parseErrors[id] ?? 0) + 1,
      },
    })),

  resetParseErrors: (id) =>
    set((state) => ({
      parseErrors: { ...state.parseErrors, [id]: 0 },
    })),

  updateIntel: (id, intel) =>
    set((state) => ({
      sessionIntel: {
        ...state.sessionIntel,
        [id]: { ...(state.sessionIntel[id] ?? { lastActivity: '', detectedUrl: null, pendingQuestion: null, outcome: null }), ...intel },
      },
    })),

  // Vacation Mode actions
  setMode: (mode) => set({ mode }),
  setReviewerSessionId: (id) => set({ reviewerSessionId: id }),
  addFounderEvent: (entry) =>
    set((state) => ({ founderEventLog: [...state.founderEventLog, entry] })),
  clearFounderEventLog: () => set({ founderEventLog: [] }),
  setOnSessionEvent: (callback) => set({ onSessionEvent: callback }),
}));

// Flush persistence immediately on window close
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const { sessions, tileSizes } = useSessionStore.getState();
    const live = sessions.filter((s) => !s.isGhost);
    if (live.length === 0) return;
    const data: PersistedSession[] = live.map((s) => ({
      tool: s.tool,
      cwd: s.cwd,
      label: s.label,
      position: s.position,
      tileSize: tileSizes[s.id] ?? { width: 560, height: 420 },
      taskTitle: s.taskTitle,
      previewUrl: s.previewUrl,
    }));
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
  });
}

// Helper to get next available position on the canvas
export function getNextPosition(sessions: SessionInfo[]): { x: number; y: number } {
  if (sessions.length === 0) return { x: 100, y: 100 };

  const cols = 3;
  const tileW = 520;
  const tileH = 360;
  const gap = 40;

  const idx = sessions.length;
  const col = idx % cols;
  const row = Math.floor(idx / cols);

  return {
    x: 100 + col * (tileW + gap),
    y: 100 + row * (tileH + gap),
  };
}
