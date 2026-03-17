export type ToolType = 'claude' | 'codex';

export type SessionStatus = 'running' | 'idle' | 'active' | 'error' | 'done';

export interface SessionInfo {
  id: string;
  tool: ToolType;
  cwd: string;
  label: string;
  status: SessionStatus;
  created_at: number;
  position: { x: number; y: number };
  isGhost?: boolean;
  taskTitle?: string;
  previewUrl?: string;
}

export interface CreateSessionRequest {
  tool: ToolType;
  cwd: string;
  initial_prompt?: string;
  taskTitle?: string;
  previewUrl?: string;
}

// --- Output Intelligence Types ---

export interface QuestionInfo {
  text: string;
  type: 'yn' | 'permission' | 'open';
  detectedAt: number;
}

export interface OutcomeInfo {
  summary: string;
  filesChanged?: number;
  duration: number;
}

export interface SessionIntel {
  lastActivity: string;
  detectedUrl: string | null;
  pendingQuestion: QuestionInfo | null;
  outcome: OutcomeInfo | null;
}
