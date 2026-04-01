import { create } from 'zustand';
import type { SessionInfo, ToolType, SessionStatus, SessionIntel, TmuxSessionInfo } from '../types/session';
// Minimal types (structured output pipeline was removed for v1)
type RenderMode = 'terminal' | 'chat';
type ChatEvent = Record<string, unknown>;
import type { EventCallback } from '../hooks/useSessionEvents';

export type AppMode = 'founder' | 'vacation';

// Module-level callback — NOT in Zustand state to avoid re-render loops
let _sessionEventCallback: EventCallback | null = null;
export function getSessionEventCallback(): EventCallback | null {
  return _sessionEventCallback;
}

export interface FounderEventLogEntry {
  ts: string;
  sessionId: string;
  event: string;
  detail: string;
}

const PERSIST_KEY = 'visualcc-sessions';
const REHYDRATE_ON_STARTUP_KEY = 'visualcc-force-ghost-rehydrate';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const DEFAULT_TILE_SIZE = { width: 560, height: 420 };

interface PersistedSession {
  tool: ToolType;
  cwd: string;
  label: string;
  position: { x: number; y: number };
  tileSize: { width: number; height: number };
  taskTitle?: string;
  previewUrl?: string;
  tmuxName?: string;
}

function readPersistedSessions(): PersistedSession[] {
  try {
    const saved = localStorage.getItem(PERSIST_KEY);
    if (!saved) return [];
    return JSON.parse(saved) as PersistedSession[];
  } catch {
    return [];
  }
}

function buildGhostSession(item: PersistedSession, index: number, now: number): SessionInfo {
  return {
    id: item.tmuxName ? item.tmuxName.replace('vcc-', '') : `ghost-${index}-${now}`,
    tool: item.tool,
    cwd: item.cwd,
    label: item.label,
    status: 'done' as SessionStatus,
    created_at: now,
    position: item.position,
    isGhost: true,
    taskTitle: item.taskTitle,
    previewUrl: item.previewUrl,
    tmuxName: item.tmuxName,
    isLiveGhost: false,
  };
}

function loadPersistedSessions(): SessionInfo[] {
  const now = Date.now();
  return readPersistedSessions().map((item, index) => buildGhostSession(item, index, now));
}

function sessionPersistenceKey(session: Pick<SessionInfo, 'tool' | 'cwd' | 'taskTitle' | 'previewUrl' | 'tmuxName'>): string {
  if (session.tmuxName) {
    return `tmux:${session.tmuxName}`;
  }

  return [
    'session',
    session.tool,
    session.cwd,
    session.taskTitle ?? '',
    session.previewUrl ?? '',
  ].join('::');
}

function toPersistedSession(
  session: SessionInfo,
  tileSizes: Record<string, { width: number; height: number }>
): PersistedSession {
  return {
    tool: session.tool,
    cwd: session.cwd,
    label: session.label,
    position: session.position,
    tileSize: tileSizes[session.id] ?? DEFAULT_TILE_SIZE,
    taskTitle: session.taskTitle,
    previewUrl: session.previewUrl,
    tmuxName: session.tmuxName,
  };
}

function serializeSessions(
  sessions: SessionInfo[],
  tileSizes: Record<string, { width: number; height: number }>
): PersistedSession[] {
  const deduped = new Map<string, PersistedSession>();

  for (const session of sessions) {
    const key = sessionPersistenceKey(session);
    if (deduped.has(key)) {
      deduped.delete(key);
    }
    deduped.set(key, toPersistedSession(session, tileSizes));
  }

  return Array.from(deduped.values());
}

function flushPersistedSessions(
  sessions: SessionInfo[],
  tileSizes: Record<string, { width: number; height: number }>
) {
  localStorage.setItem(PERSIST_KEY, JSON.stringify(serializeSessions(sessions, tileSizes)));
}

function buildStartupGhost(session: SessionInfo): SessionInfo {
  return {
    ...session,
    status: 'done',
    isGhost: true,
    isLiveGhost: false,
  };
}

function persistSessions(sessions: SessionInfo[], tileSizes: Record<string, { width: number; height: number }>) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersistedSessions(sessions, tileSizes);
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

  addSession: (session: SessionInfo, renderMode?: RenderMode) => void;
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
  /** Mark ghost tiles as live if their tmux session is still running */
  markLiveGhosts: (liveTmuxSessions: TmuxSessionInfo[]) => void;
  /** Replace a live ghost with a reattached session */
  reattachGhost: (ghostId: string, newSession: SessionInfo) => void;
  /** Normalize any lingering live sessions into ghosts when the app boots back up */
  prepareForStartup: () => void;

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
  const items = readPersistedSessions();
  initialGhosts.forEach((ghost, i) => {
    initialTileSizes[ghost.id] = items[i]?.tileSize ?? DEFAULT_TILE_SIZE;
  });
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

  addSession: (session, renderMode) =>
    set((state) => {
      const next = {
        sessions: [...state.sessions, session],
        messages: { ...state.messages, [session.id]: [] as ChatEvent[] },
        renderModes: { ...state.renderModes, [session.id]: (renderMode ?? 'chat') as RenderMode },
        parseErrors: { ...state.parseErrors, [session.id]: 0 },
        tileSizes: { ...state.tileSizes, [session.id]: DEFAULT_TILE_SIZE },
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

  relaunchGhost: (ghostId, newSession) =>
    set((state) => {
      const ghost = state.sessions.find((s) => s.id === ghostId);
      const ghostTileSize = state.tileSizes[ghostId] ?? DEFAULT_TILE_SIZE;
      const { [ghostId]: _msgs, ...restMessages } = state.messages;
      const { [ghostId]: _mode, ...restModes } = state.renderModes;
      const { [ghostId]: _errs, ...restErrors } = state.parseErrors;
      const { [ghostId]: _size, ...restSizes } = state.tileSizes;
      const { [ghostId]: _intel, ...restIntel } = state.sessionIntel;
      const next = {
        sessions: state.sessions
          .filter((s) => s.id !== ghostId)
          .concat({ ...newSession, position: ghost?.position ?? newSession.position }),
        messages: { ...restMessages, [newSession.id]: [] as ChatEvent[] },
        renderModes: { ...restModes, [newSession.id]: 'terminal' as RenderMode },
        parseErrors: { ...restErrors, [newSession.id]: 0 },
        tileSizes: { ...restSizes, [newSession.id]: ghostTileSize },
        sessionIntel: restIntel,
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

  markLiveGhosts: (liveTmuxSessions) =>
    set((state) => {
      const liveNames = new Set(liveTmuxSessions.map((s) => s.tmux_name));
      return {
        sessions: state.sessions.map((s) => {
          if (s.isGhost && s.tmuxName) {
            return { ...s, isLiveGhost: liveNames.has(s.tmuxName) };
          }
          return s;
        }),
      };
    }),

  reattachGhost: (ghostId, newSession) =>
    set((state) => {
      const ghost = state.sessions.find((s) => s.id === ghostId);
      const ghostTileSize = state.tileSizes[ghostId] ?? DEFAULT_TILE_SIZE;
      const { [ghostId]: _msgs, ...restMessages } = state.messages;
      const { [ghostId]: _mode, ...restModes } = state.renderModes;
      const { [ghostId]: _errs, ...restErrors } = state.parseErrors;
      const { [ghostId]: _size, ...restSizes } = state.tileSizes;
      const { [ghostId]: _intel, ...restIntel } = state.sessionIntel;
      const next = {
        sessions: state.sessions
          .filter((s) => s.id !== ghostId)
          .concat({ ...newSession, position: ghost?.position ?? newSession.position }),
        messages: { ...restMessages, [newSession.id]: [] as ChatEvent[] },
        renderModes: { ...restModes, [newSession.id]: 'terminal' as RenderMode },
        parseErrors: { ...restErrors, [newSession.id]: 0 },
        tileSizes: { ...restSizes, [newSession.id]: ghostTileSize },
        sessionIntel: restIntel,
      };
      persistSessions(next.sessions, next.tileSizes);
      return next;
    }),

  prepareForStartup: () =>
    set((state) => {
      const shouldRehydrateGhosts = localStorage.getItem(REHYDRATE_ON_STARTUP_KEY) === '1';
      localStorage.removeItem(REHYDRATE_ON_STARTUP_KEY);

      if (!shouldRehydrateGhosts) {
        return state;
      }

      const hasLiveSessions = state.sessions.some((session) => !session.isGhost);
      if (!hasLiveSessions) {
        return state;
      }

      const next = {
        sessions: state.sessions.map((session) =>
          session.isGhost ? session : buildStartupGhost(session)
        ),
        messages: {},
        renderModes: {},
        parseErrors: {},
        tileSizes: state.tileSizes,
        sessionIntel: {},
      };
      flushPersistedSessions(next.sessions, next.tileSizes);
      return next;
    }),

  // Vacation Mode actions
  setMode: (mode) => set({ mode }),
  setReviewerSessionId: (id) => set({ reviewerSessionId: id }),
  addFounderEvent: (entry) =>
    set((state) => ({ founderEventLog: [...state.founderEventLog, entry] })),
  clearFounderEventLog: () => set({ founderEventLog: [] }),
  setOnSessionEvent: (callback) => { _sessionEventCallback = callback; },
}));

// Flush persistence immediately on window close
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const { sessions, tileSizes } = useSessionStore.getState();
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    localStorage.setItem(REHYDRATE_ON_STARTUP_KEY, '1');
    flushPersistedSessions(sessions, tileSizes);
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
