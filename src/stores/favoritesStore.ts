import { create } from 'zustand';
import type { ToolType } from '../types/session';

const STORAGE_KEY = 'visualcc-favorites';
const MAX_FAVORITES = 10;

export interface Favorite {
  id: string;
  tool: ToolType;
  cwd: string;
  label: string;
}

interface FavoritesStore {
  favorites: Favorite[];
  addFavorite: (tool: ToolType, cwd: string) => void;
  removeFavorite: (id: string) => void;
  isFavorited: (tool: ToolType, cwd: string) => boolean;
}

function loadFavorites(): Favorite[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveFavorites(favorites: Favorite[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  favorites: loadFavorites(),

  addFavorite: (tool, cwd) =>
    set((state) => {
      if (state.favorites.length >= MAX_FAVORITES) return state;
      if (state.favorites.some((f) => f.tool === tool && f.cwd === cwd)) return state;
      const label = cwd.split('/').pop() || cwd;
      const fav: Favorite = { id: `fav-${Date.now()}`, tool, cwd, label };
      const next = [...state.favorites, fav];
      saveFavorites(next);
      return { favorites: next };
    }),

  removeFavorite: (id) =>
    set((state) => {
      const next = state.favorites.filter((f) => f.id !== id);
      saveFavorites(next);
      return { favorites: next };
    }),

  isFavorited: (tool, cwd) => {
    return get().favorites.some((f) => f.tool === tool && f.cwd === cwd);
  },
}));
