import type {
  ToolAdapter,
  ChatEvent,
  ContentBlock,
  StderrEvent,
} from './types';

// Codex CLI --json event shapes
interface CodexSessionMeta {
  type: 'session_meta';
  session_id?: string;
  model?: string;
  [key: string]: unknown;
}

interface CodexContentItem {
  type: 'message' | 'function_call' | 'function_call_output';
  role?: string;
  text?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: string;
  [key: string]: unknown;
}

interface CodexEventMsg {
  type: 'event_msg';
  items?: CodexContentItem[];
  [key: string]: unknown;
}

interface CodexResponseItem {
  type: 'response_item';
  item?: CodexContentItem;
  [key: string]: unknown;
}

interface CodexTurnContext {
  type: 'turn_context';
  [key: string]: unknown;
}

type CodexRawEvent =
  | CodexSessionMeta
  | CodexEventMsg
  | CodexResponseItem
  | CodexTurnContext;

function mapCodexItem(item: CodexContentItem): ContentBlock {
  switch (item.type) {
    case 'message':
      return { type: 'text', text: item.text ?? '' };

    case 'function_call': {
      let parsedInput: unknown = item.arguments ?? '';
      try {
        if (typeof item.arguments === 'string') {
          parsedInput = JSON.parse(item.arguments);
        }
      } catch {
        // Keep as string
      }
      return {
        type: 'tool_use',
        id: item.call_id ?? '',
        name: item.name ?? 'unknown',
        input: parsedInput,
      };
    }

    case 'function_call_output':
      return {
        type: 'tool_result',
        toolUseId: item.call_id ?? '',
        content: item.output ?? '',
        isError: false,
      };

    default:
      return { type: 'text', text: JSON.stringify(item) };
  }
}

function parseCodexLine(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: CodexRawEvent;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object' || !('type' in raw)) return null;

  switch (raw.type) {
    case 'session_meta': {
      const evt = raw as CodexSessionMeta;
      return {
        type: 'system',
        message: `Codex session started${evt.model ? ` (${evt.model})` : ''}`,
        sessionId: evt.session_id,
        _raw: raw,
      };
    }

    case 'event_msg': {
      const evt = raw as CodexEventMsg;
      const items = evt.items ?? [];
      if (items.length === 0) return null;

      // Separate assistant messages from tool results
      const assistantItems = items.filter(
        (i) => i.role === 'assistant' || i.type === 'function_call'
      );
      const userItems = items.filter(
        (i) => i.type === 'function_call_output' || i.role === 'user'
      );

      // If we have both, emit the assistant message (tool results come as separate events)
      const blocks: ContentBlock[] = (
        assistantItems.length > 0 ? assistantItems : items
      ).map(mapCodexItem);

      if (userItems.length > 0 && assistantItems.length === 0) {
        return {
          type: 'user_message',
          blocks: userItems.map(mapCodexItem),
          _raw: raw,
        };
      }

      return {
        type: 'assistant_message',
        blocks,
        _raw: raw,
      };
    }

    case 'response_item': {
      const evt = raw as CodexResponseItem;
      if (!evt.item) return null;
      const block = mapCodexItem(evt.item);
      const isUser =
        evt.item.type === 'function_call_output' || evt.item.role === 'user';
      return {
        type: isUser ? 'user_message' : 'assistant_message',
        blocks: [block],
        _raw: raw,
      };
    }

    case 'turn_context':
      return null; // Skip turn context events

    default:
      return {
        type: 'unknown',
        rawType: String((raw as Record<string, unknown>).type ?? 'unknown'),
        _raw: raw,
      };
  }
}

export const codexAdapter: ToolAdapter = {
  parseLine: parseCodexLine,

  formatInput(_text: string): string {
    // Codex doesn't support interactive input
    return '';
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
    supportsInteractiveInput: false,
    inputFormat: 'none',
  },
};
