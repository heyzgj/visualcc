import { create } from 'zustand';

const STORAGE_KEY = 'visualcc-settings';

interface Settings {
  notificationsEnabled: boolean;
}

interface SettingsStore extends Settings {
  toggleNotifications: () => void;
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { notificationsEnabled: true };
}

function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...loadSettings(),

  toggleNotifications: () =>
    set((state) => {
      const next = { notificationsEnabled: !state.notificationsEnabled };
      saveSettings(next);
      return next;
    }),
}));
