import { create } from 'zustand';
import { removeCardsForSession, upsertClockworkCard, type ClockworkCardEntry } from '../utils/clockworkCards';

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
  upsertClockworkCard: (parsed: ClockworkCardEntry, filePath: string) => void;
  resolveCard: (id: string) => void;
  resolveCardsForSession: (sessionId: string) => void;
  updateCard: (id: string, updates: Partial<DecisionCard>) => void;
  dismissCard: (id: string) => void;
}

export const useCardStore = create<CardStore>((set) => ({
  cards: [],

  addCard: (card) =>
    set((state) => ({
      cards: [card, ...state.cards],  // Newest first
    })),

  upsertClockworkCard: (parsed, filePath) =>
    set((state) => ({
      cards: upsertClockworkCard(
        state.cards,
        parsed,
        filePath,
        Date.now(),
        () => `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ),
    })),

  resolveCard: (id) =>
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== id),
    })),

  resolveCardsForSession: (sessionId) =>
    set((state) => ({
      cards: removeCardsForSession(state.cards, sessionId),
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
