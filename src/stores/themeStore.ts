import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

const savedTheme = (localStorage.getItem('visualcc-theme') as Theme) || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: savedTheme,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('visualcc-theme', next);
      return { theme: next };
    }),
}));
