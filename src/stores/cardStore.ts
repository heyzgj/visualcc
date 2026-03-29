import { create } from 'zustand';

export interface DecisionCard {
  id: string;
  sessionId: string;
  project: string;
  title: string;
  context: string;
  options: Array<{ label: string; description: string; recommended: boolean }>;
  recommendReasoning: string;
  isTasteDecision: boolean;
  exchangeCount: number;  // 0 = initial, max 2
  createdAt: number;
  filePath?: string;  // Path to the card file (for deletion on resolve)
  isWaiting?: boolean; // "Waiting for Reviewer..." state
}

interface CardStore {
  cards: DecisionCard[];

  addCard: (card: DecisionCard) => void;
  resolveCard: (id: string) => void;
  updateCard: (id: string, updates: Partial<DecisionCard>) => void;
  dismissCard: (id: string) => void;
}

export const useCardStore = create<CardStore>((set) => ({
  cards: [],

  addCard: (card) =>
    set((state) => ({
      cards: [card, ...state.cards],  // Newest first
    })),

  resolveCard: (id) =>
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== id),
    })),

  updateCard: (id, updates) =>
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  dismissCard: (id) =>
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== id),
    })),
}));
