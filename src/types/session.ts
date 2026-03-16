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
}

export interface CreateSessionRequest {
  tool: ToolType;
  cwd: string;
  initial_prompt?: string;
}
