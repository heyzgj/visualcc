import type {
  ToolAdapter,
  ChatEvent,
  ContentBlock,
  StderrEvent,
} from './types';

// Claude Code --output-format stream-json event shapes
interface ClaudeSystemEvent {
  type: 'system';
  subtype?: string;
  session_id?: string;
  tools?: unknown[];
  mcp_servers?: unknown[];
  [key: string]: unknown;
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'thinking' | 'tool_result';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | { type: string; text?: string }[];
  is_error?: boolean;
}

interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    content: ClaudeContentBlock[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ClaudeUserEvent {
  type: 'user';
  message: {
    content: ClaudeContentBlock[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ClaudeResultEvent {
  type: 'result';
  subtype?: string;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  [key: string]: unknown;
}

interface ClaudeRateLimitEvent {
  type: 'rate_limit_event';
  retry_after_seconds?: number;
  message?: string;
  [key: string]: unknown;
}

type ClaudeRawEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
  | ClaudeRateLimitEvent;

function mapContentBlock(block: ClaudeContentBlock): ContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking ?? '' };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id ?? '',
        name: block.name ?? 'unknown',
        input: block.input ?? {},
      };
    case 'tool_result': {
      let content = '';
      if (typeof block.content === 'string') {
        content = block.content;
      } else if (Array.isArray(block.content)) {
        content = block.content
          .map((c) => (typeof c === 'string' ? c : c.text ?? ''))
          .join('\n');
      }
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id ?? '',
        content,
        isError: block.is_error ?? false,
      };
    }
    default:
      return { type: 'text', text: JSON.stringify(block) };
  }
}

function parseClaudeLine(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: ClaudeRawEvent;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object' || !('type' in raw)) return null;

  switch (raw.type) {
    case 'system': {
      const evt = raw as ClaudeSystemEvent;
      return {
        type: 'system',
        message: evt.subtype === 'init' ? 'Session initialized' : (evt.subtype ?? 'system'),
        sessionId: evt.session_id,
        _raw: raw,
      };
    }

    case 'assistant': {
      const evt = raw as ClaudeAssistantEvent;
      const blocks = (evt.message?.content ?? []).map(mapContentBlock);
      return {
        type: 'assistant_message',
        blocks,
        _raw: raw,
      };
    }

    case 'user': {
      const evt = raw as ClaudeUserEvent;
      const blocks = (evt.message?.content ?? []).map(mapContentBlock);
      return {
        type: 'user_message',
        blocks,
        _raw: raw,
      };
    }

    case 'result': {
      const evt = raw as ClaudeResultEvent;
      const usage = evt.usage;
      const totalTokens = usage
        ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
        : undefined;
      return {
        type: 'result',
        subtype: evt.subtype === 'error' ? 'error' : 'success',
        costUsd: evt.total_cost_usd ?? evt.cost_usd,
        durationMs: evt.duration_ms ?? evt.duration_api_ms,
        totalTokens,
        message: evt.result,
        _raw: raw,
      };
    }

    case 'rate_limit_event': {
      const evt = raw as ClaudeRateLimitEvent;
      return {
        type: 'rate_limit',
        retrySec: evt.retry_after_seconds,
        message: evt.message ?? 'Rate limited',
        _raw: raw,
      };
    }

    default:
      return {
        type: 'unknown',
        rawType: String((raw as Record<string, unknown>).type ?? 'unknown'),
        _raw: raw,
      };
  }
}

export const claudeAdapter: ToolAdapter = {
  parseLine: parseClaudeLine,

  formatInput(text: string): string {
    return JSON.stringify({
      type: 'user_message',
      content: text,
    }) + '\n';
  },

  parseStderr(line: string): StderrEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal')) {
      return { level: 'error', message: trimmed };
    }
    if (lower.includes('warn')) {
      return { level: 'warn', message: trimmed };
    }
    return { level: 'info', message: trimmed };
  },

  inputCapabilities: {
    supportsInteractiveInput: true,
    inputFormat: 'stream-json',
  },
};
