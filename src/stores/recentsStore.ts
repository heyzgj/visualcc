import { create } from 'zustand';
import type { ToolType } from '../types/session';

const STORAGE_KEY = 'visualcc-recents';
const MAX_RECENTS = 8;

export interface RecentEntry {
  tool: ToolType;
  cwd: string;
  label: string;
  usedAt: number;
}

interface RecentsStore {
  recents: RecentEntry[];
  addRecent: (tool: ToolType, cwd: string) => void;
}

function loadRecents(): RecentEntry[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveRecents(recents: RecentEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
}

export const useRecentsStore = create<RecentsStore>((set) => ({
  recents: loadRecents(),

  addRecent: (tool, cwd) =>
    set((state) => {
      // Remove existing entry for same cwd (regardless of tool)
      const filtered = state.recents.filter((r) => r.cwd !== cwd);
      const label = cwd.split('/').pop() || cwd;
      const entry: RecentEntry = { tool, cwd, label, usedAt: Date.now() };
      // Prepend new entry, cap at MAX_RECENTS
      const next = [entry, ...filtered].slice(0, MAX_RECENTS);
      saveRecents(next);
      return { recents: next };
    }),
}));
