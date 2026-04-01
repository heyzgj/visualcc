import type { QuestionInfo } from '../types/session';

export interface PromptDetectionInput {
  recentLines: string[];
  partialLine?: string;
  detectedAt?: number;
}

export const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/;
export const BUILD_PATTERNS = /Installing\.\.\.|Building\.\.\.|Testing\.\.\.|Compiling\.\.\.|Downloading|Resolving|npm\s+(install|ci)|yarn\s+install|pnpm\s+install|cargo\s+build|running\s+tests/i;
export const ERROR_PATTERNS = /\bfatal\b|\bpanic\b|\bunhandled\s+exception\b|\bsegmentation\s+fault\b|\bkilled\b/i;

const YN_REGEX = /\(Y\/n\)|\(y\/N\)|\[Y\/n\]|\[y\/N\]|\(yes\/no\)/i;
const PERMISSION_REGEX = /\bAllow\b|\bPermission\b|\bapprove\b|\bAccept\b|\bproceed\b.*\?|\bconfirm\b.*\bpermission\b/i;
const SIGNAL_WORDS_REGEX = /waiting for|need guidance|your input|please advise|what would you like|should I|what should|how should|would you like me to|do you want me to|can you confirm/i;
const ENTER_PROMPT_REGEX = /\bpress (?:enter|return|any key) to continue\b|\bpress enter\b|\bpress return\b/i;
const TRUST_PROMPT_REGEX = /\bdo you trust\b|\btrust the contents of this directory\b|\bworking with untrusted contents\b/i;
const CHOICE_PROMPT_REGEX = /\b(?:choose|select|pick)\b.*\b(?:option|one)\b|\bwhich option\b|\benter a number\b/i;
const COMPACT_ENTER_REGEX = /press(?:enter|return|anykey)tocontinue/;
const COMPACT_TRUST_REGEX = /doyoutrustthecontentsofthisdirectory|workingwithuntrustedcontents/;
const INTERACTIVE_CHOICE_WORDS_REGEX = /\b(?:continue|quit|update|skip|yes|no|trust|select|choose|option|pick|allow|deny)\b/i;

function normalizePromptLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function compactPromptText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function countNumberedOptions(lines: string[], joinedText: string, compactText: string): number {
  let count = 0;

  for (const line of lines) {
    if (/^[>\s>*-]*\d+\.\s+/.test(line)) {
      count += 1;
    }
  }

  if (count >= 2) return count;

  const joinedMatches = joinedText.match(/(?:^|\s|[>›])\d+\.\s+/g);
  count = Math.max(count, joinedMatches?.length ?? 0);

  if (count >= 2) return count;

  const compactMatches = compactText.match(/\d+\./g);
  return Math.max(count, compactMatches?.length ?? 0);
}

function formatQuestionText(lines: string[]): string {
  const uniqueLines: string[] = [];

  for (const line of lines.slice(-4)) {
    if (uniqueLines[uniqueLines.length - 1] !== line) {
      uniqueLines.push(line);
    }
  }

  const text = uniqueLines.join('\n').trim();
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

export function detectPendingQuestion({
  recentLines,
  partialLine = '',
  detectedAt = Date.now(),
}: PromptDetectionInput): QuestionInfo | null {
  const normalizedLines = recentLines
    .slice(-6)
    .map(normalizePromptLine)
    .filter(Boolean);

  const normalizedPartial = normalizePromptLine(partialLine);
  if (normalizedPartial) {
    normalizedLines.push(normalizedPartial);
  }

  if (normalizedLines.length === 0) return null;

  const joinedText = normalizedLines.join(' ');
  const compactText = compactPromptText(joinedText);
  const optionCount = countNumberedOptions(normalizedLines, joinedText, compactText);
  const hasInteractiveChoiceWords =
    INTERACTIVE_CHOICE_WORDS_REGEX.test(joinedText) ||
    /(continue|quit|update|skip|yes|no|trust|select|choose|option|pick|allow|deny)/.test(compactText);

  const makeQuestion = (type: QuestionInfo['type']): QuestionInfo => ({
    text: formatQuestionText(normalizedLines),
    type,
    detectedAt,
  });

  if (YN_REGEX.test(joinedText)) {
    return makeQuestion('yn');
  }

  if (
    TRUST_PROMPT_REGEX.test(joinedText) ||
    COMPACT_TRUST_REGEX.test(compactText) ||
    CHOICE_PROMPT_REGEX.test(joinedText) ||
    (optionCount >= 2 && hasInteractiveChoiceWords)
  ) {
    return makeQuestion('choice');
  }

  if (PERMISSION_REGEX.test(joinedText)) {
    return makeQuestion('permission');
  }

  if (ENTER_PROMPT_REGEX.test(joinedText) || COMPACT_ENTER_REGEX.test(compactText)) {
    return makeQuestion('enter');
  }

  if (SIGNAL_WORDS_REGEX.test(joinedText)) {
    return makeQuestion('open');
  }

  return null;
}
