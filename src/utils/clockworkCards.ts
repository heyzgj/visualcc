import type { DecisionCard } from '../stores/cardStore';

export interface ClockworkCardEntry {
  sessionId: string;
  project: string;
  title: string;
  context: string;
  options: Array<{ label: string; description: string; recommended: boolean }>;
  recommendReasoning: string;
  isTasteDecision: boolean;
}

function buildCardBase(parsed: ClockworkCardEntry, filePath: string, createdAt: number): Omit<DecisionCard, 'id' | 'exchangeCount'> {
  return {
    sessionId: parsed.sessionId,
    project: parsed.project ?? 'Unknown',
    title: parsed.title ?? 'Decision needed',
    context: parsed.context ?? '',
    options: parsed.options ?? [],
    recommendReasoning: parsed.recommendReasoning ?? '',
    isTasteDecision: parsed.isTasteDecision ?? false,
    createdAt,
    filePath,
    isWaiting: false,
  };
}

export function upsertClockworkCard(
  cards: DecisionCard[],
  parsed: ClockworkCardEntry,
  filePath: string,
  createdAt: number,
  makeId: () => string
): DecisionCard[] {
  const existingIndex = cards.findIndex(
    (card) => card.filePath === filePath || card.sessionId === parsed.sessionId
  );
  const nextBase = buildCardBase(parsed, filePath, createdAt);

  if (existingIndex === -1) {
    return [
      {
        id: makeId(),
        exchangeCount: 0,
        ...nextBase,
      },
      ...cards,
    ];
  }

  return cards.map((card, index) =>
    index === existingIndex
      ? {
          ...card,
          ...nextBase,
        }
      : card
  );
}

export function removeCardsForSession(cards: DecisionCard[], sessionId: string): DecisionCard[] {
  return cards.filter((card) => card.sessionId !== sessionId);
}
