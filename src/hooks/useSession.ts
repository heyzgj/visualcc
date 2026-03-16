import { invoke } from '@tauri-apps/api/core';
import type { SessionInfo, CreateSessionRequest } from '../types/session';
import type { RenderMode } from '../adapters/types';
import { useSessionStore, getNextPosition } from '../stores/sessionStore';

export function useSession() {
  const { sessions, addSession, removeSession } = useSessionStore();

  // Create a PTY-based session (terminal mode)
  async function createSession(req: CreateSessionRequest) {
    try {
      const id = await invoke<string>('create_session', {
        tool: req.tool,
        cwd: req.cwd,
        initialPrompt: req.initial_prompt ?? null,
      });

      const position = getNextPosition(sessions);
      const dirName = req.cwd.split('/').pop() || req.cwd;

      const session: SessionInfo = {
        id,
        tool: req.tool,
        cwd: req.cwd,
        label: dirName,
        status: 'running',
        created_at: Date.now(),
        position,
      };

      addSession(session);
      // Override render mode to terminal for PTY sessions
      useSessionStore.getState().setRenderMode(id, 'terminal');
      return session;
    } catch (err) {
      console.error('Failed to create session:', err);
      throw err;
    }
  }

  // Create a structured output session (chat mode)
  async function createStructuredSession(req: CreateSessionRequest) {
    try {
      const id = await invoke<string>('create_structured_session', {
        tool: req.tool,
        cwd: req.cwd,
        initialPrompt: req.initial_prompt ?? null,
      });

      const position = getNextPosition(sessions);
      const dirName = req.cwd.split('/').pop() || req.cwd;

      const session: SessionInfo = {
        id,
        tool: req.tool,
        cwd: req.cwd,
        label: dirName,
        status: 'running',
        created_at: Date.now(),
        position,
      };

      addSession(session);
      // Render mode defaults to 'chat' via addSession
      return session;
    } catch (err) {
      console.error('Failed to create structured session:', err);
      throw err;
    }
  }

  async function killSession(id: string) {
    try {
      await invoke('kill_session', { id });
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
    removeSession(id);
  }

  async function killStructuredSession(id: string) {
    try {
      await invoke('kill_structured_session', { id });
    } catch (err) {
      console.error('Failed to kill structured session:', err);
    }
    removeSession(id);
  }

  async function writeToSession(id: string, data: string) {
    try {
      await invoke('write_to_session', { id, data });
    } catch (err) {
      console.error('Failed to write to session:', err);
    }
  }

  async function resizeSession(id: string, cols: number, rows: number) {
    try {
      await invoke('resize_session', { id, cols, rows });
    } catch (err) {
      console.error('Failed to resize session:', err);
    }
  }

  return {
    createSession,
    createStructuredSession,
    killSession,
    killStructuredSession,
    writeToSession,
    resizeSession,
  };
}
