import { create } from 'zustand';
import type { SessionInfo, ToolType, SessionStatus } from '../types/session';
import type { ChatEvent, RenderMode } from '../adapters/types';

interface SessionStore {
  sessions: SessionInfo[];
  showNewDialog: boolean;
  messages: Record<string, ChatEvent[]>;
  renderModes: Record<string, RenderMode>;
  parseErrors: Record<string, number>;
  tileSizes: Record<string, { width: number; height: number }>;

  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  updateStatus: (id: string, status: SessionStatus) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateTileSize: (id: string, width: number, height: number) => void;
  setShowNewDialog: (show: boolean) => void;
  addMessage: (id: string, event: ChatEvent) => void;
  setRenderMode: (id: string, mode: RenderMode) => void;
  incrementParseErrors: (id: string) => void;
  resetParseErrors: (id: string) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  showNewDialog: false,
  messages: {},
  renderModes: {},
  parseErrors: {},
  tileSizes: {},

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      messages: { ...state.messages, [session.id]: [] },
      renderModes: { ...state.renderModes, [session.id]: 'chat' },
      parseErrors: { ...state.parseErrors, [session.id]: 0 },
      tileSizes: { ...state.tileSizes, [session.id]: { width: 560, height: 420 } },
    })),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _msgs, ...restMessages } = state.messages;
      const { [id]: _mode, ...restModes } = state.renderModes;
      const { [id]: _errs, ...restErrors } = state.parseErrors;
      const { [id]: _size, ...restSizes } = state.tileSizes;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messages: restMessages,
        renderModes: restModes,
        parseErrors: restErrors,
        tileSizes: restSizes,
      };
    }),

  updateStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  updatePosition: (id, x, y) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, position: { x, y } } : s
      ),
    })),

  updateTileSize: (id, width, height) =>
    set((state) => ({
      tileSizes: { ...state.tileSizes, [id]: { width, height } },
    })),

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
}));

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
