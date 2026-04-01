import assert from 'node:assert/strict';
import { detectPendingQuestion } from '../src/utils/sessionPromptDetection.ts';

interface PromptFixture {
  name: string;
  recentLines: string[];
  partialLine?: string;
  expectedType: NonNullable<ReturnType<typeof detectPendingQuestion>>['type'] | null;
}

const fixtures: PromptFixture[] = [
  {
    name: 'yes-no prompt',
    recentLines: ['Install dependencies now? (Y/n)'],
    expectedType: 'yn',
  },
  {
    name: 'permission prompt',
    recentLines: ['Allow network access for this task?'],
    expectedType: 'permission',
  },
  {
    name: 'open question prompt',
    recentLines: ['I need guidance on which migration strategy to use.'],
    expectedType: 'open',
  },
  {
    name: 'codex trust dialog with numbered options',
    recentLines: [
      'Do you trust the contents of this directory?',
      '1. Yes, allow once',
      '2. No, exit',
    ],
    partialLine: 'Press Enter to continue',
    expectedType: 'choice',
  },
  {
    name: 'pure enter prompt',
    recentLines: ['Update finished successfully.'],
    partialLine: 'Press enter to continue',
    expectedType: 'enter',
  },
  {
    name: 'compact trust prompt',
    recentLines: [],
    partialLine: 'Doyoutrustthecontentsofthisdirectory?1.Yes,allowonce2.No,exitPressentertocontinue',
    expectedType: 'choice',
  },
  {
    name: 'select option prompt',
    recentLines: ['Select an option to continue', '1. Continue', '2. Quit'],
    expectedType: 'choice',
  },
  {
    name: 'build output stays non-interactive',
    recentLines: ['Running tests...', '12 passed in 4.2s'],
    expectedType: null,
  },
];

for (const fixture of fixtures) {
  const question = detectPendingQuestion({
    recentLines: fixture.recentLines,
    partialLine: fixture.partialLine,
    detectedAt: 12345,
  });

  assert.equal(
    question?.type ?? null,
    fixture.expectedType,
    `${fixture.name}: expected ${fixture.expectedType ?? 'null'} but got ${question?.type ?? 'null'}`
  );

  if (question) {
    assert.equal(question.detectedAt, 12345, `${fixture.name}: detectedAt should be preserved`);
    assert.ok(question.text.length > 0, `${fixture.name}: question text should not be empty`);
  }
}

console.log(`Prompt detection fixtures passed (${fixtures.length} cases)`);
