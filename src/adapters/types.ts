// === Unified Chat Event Model ===
// All tool-specific NDJSON events get mapped to these types

export interface SystemEvent {
  type: 'system';
  message: string;
  sessionId?: string;
  _raw: unknown;
}

export interface AssistantMessageEvent {
  type: 'assistant_message';
  blocks: ContentBlock[];
  _raw: unknown;
}

export interface UserMessageEvent {
  type: 'user_message';
  blocks: ContentBlock[];
  _raw: unknown;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  costUsd?: number;
  durationMs?: number;
  totalTokens?: number;
  message?: string;
  _raw: unknown;
}

export interface RateLimitEvent {
  type: 'rate_limit';
  retrySec?: number;
  message: string;
  _raw: unknown;
}

export interface UnknownEvent {
  type: 'unknown';
  rawType: string;
  _raw: unknown;
}

export type ChatEvent =
  | SystemEvent
  | AssistantMessageEvent
  | UserMessageEvent
  | ResultEvent
  | RateLimitEvent
  | UnknownEvent;

// === Content Blocks ===

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface CodeBlock {
  type: 'code';
  language: string;
  code: string;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | CodeBlock;

// === Adapter Interface ===

export interface InputCapabilities {
  supportsInteractiveInput: boolean;
  inputFormat: 'stream-json' | 'none';
}

export interface StderrEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ToolAdapter {
  parseLine(line: string): ChatEvent | null;
  formatInput(text: string): string;
  parseStderr(line: string): StderrEvent | null;
  inputCapabilities: InputCapabilities;
}

// === Render Mode ===

export type RenderMode = 'chat' | 'terminal';
