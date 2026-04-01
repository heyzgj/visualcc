import assert from 'node:assert/strict';
import { removeCardsForSession, upsertClockworkCard } from '../src/utils/clockworkCards.ts';
import type { DecisionCard } from '../src/stores/cardStore.ts';

const baseEntry = {
  sessionId: 'worker-1',
  project: 'alpha',
  title: 'Need a decision',
  context: 'Worker is blocked on a tradeoff.',
  options: [
    { label: 'Ship A', description: 'Safer', recommended: true },
    { label: 'Ship B', description: 'Riskier', recommended: false },
  ],
  recommendReasoning: 'Prefer the safer option.',
  isTasteDecision: false,
};

const createId = () => 'card-fixed';

const inserted = upsertClockworkCard([], baseEntry, '/tmp/.clockwork/cards/worker-1.json', 1000, createId);
assert.equal(inserted.length, 1, 'should add a new card when none exists');
assert.equal(inserted[0]?.id, 'card-fixed', 'should use generated id for first insert');
assert.equal(inserted[0]?.exchangeCount, 0, 'new card should start at zero exchanges');

const waitingCard: DecisionCard = {
  ...inserted[0]!,
  exchangeCount: 1,
  isWaiting: true,
};

const updated = upsertClockworkCard(
  [waitingCard],
  {
    ...baseEntry,
    title: 'Updated recommendation',
    context: 'Reviewer incorporated owner feedback.',
    options: [{ label: 'Ship C', description: 'Balanced', recommended: true }],
  },
  '/tmp/.clockwork/cards/worker-1.json',
  2000,
  () => 'unused'
);

assert.equal(updated.length, 1, 'should update existing card in place');
assert.equal(updated[0]?.id, waitingCard.id, 'updated card should preserve original id');
assert.equal(updated[0]?.exchangeCount, 1, 'updated card should preserve exchange count');
assert.equal(updated[0]?.isWaiting, false, 'updated card should clear waiting state');
assert.equal(updated[0]?.title, 'Updated recommendation', 'updated card should refresh title');
assert.equal(updated[0]?.createdAt, 2000, 'updated card should refresh timestamp');

const cleared = removeCardsForSession(updated, 'worker-1');
assert.equal(cleared.length, 0, 'should remove all cards for the resolved session');

console.log('Clockwork card state fixtures passed');
