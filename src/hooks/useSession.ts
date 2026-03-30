import { invoke } from '@tauri-apps/api/core';
import type { SessionInfo, CreateSessionRequest, TmuxSessionInfo } from '../types/session';
import { useSessionStore, getNextPosition } from '../stores/sessionStore';

export function useSession() {
  // Use getState() for reads inside callbacks to avoid subscribing to full store
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);

  // Create a PTY-based session (terminal mode)
  async function createSession(req: CreateSessionRequest) {
    try {
      console.log('[VisualCC] useSession.createSession invoking Tauri create_session', req.tool, req.cwd);
      const id = await invoke<string>('create_session', {
        tool: req.tool,
        cwd: req.cwd,
        initialPrompt: req.initial_prompt ?? null,
      });
      console.log('[VisualCC] Tauri create_session returned id:', id);

      // Check if tmux is available to determine if we got a tmux-backed session
      let tmuxName: string | undefined;
      try {
        const tmuxAvailable = await invoke<boolean>('check_tmux');
        if (tmuxAvailable) {
          tmuxName = `vcc-${id}`;
        }
      } catch {
        // Ignore — tmux detection failed, session is direct PTY
      }

      const position = getNextPosition(useSessionStore.getState().sessions);
      const dirName = req.cwd.split('/').pop() || req.cwd;

      const session: SessionInfo = {
        id,
        tool: req.tool,
        cwd: req.cwd,
        label: dirName,
        status: 'running',
        created_at: Date.now(),
        position,
        taskTitle: req.taskTitle,
        previewUrl: req.previewUrl,
        tmuxName,
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

      const position = getNextPosition(useSessionStore.getState().sessions);
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

  // Close a session: detach if tmux-backed, kill otherwise
  async function closeSession(id: string) {
    const session = useSessionStore.getState().sessions.find((s) => s.id === id);
    if (session?.tmuxName) {
      // tmux-backed: detach only (session keeps running)
      try {
        await invoke('detach_session', { id });
      } catch (err) {
        console.error('Failed to detach session:', err);
      }
    } else {
      // Direct PTY: kill
      try {
        await invoke('kill_session', { id });
      } catch (err) {
        console.error('Failed to kill session:', err);
      }
    }
    removeSession(id);
  }

  // Kill a session entirely (including tmux session if any)
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

  // Kill a tmux session by its tmux name (for orphaned sessions)
  async function killTmuxSessionByName(tmuxName: string) {
    try {
      await invoke('kill_tmux_session_by_name', { tmuxName });
    } catch (err) {
      console.error('Failed to kill tmux session:', err);
    }
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

  async function relaunchSession(ghostId: string) {
    const ghost = useSessionStore.getState().sessions.find((s) => s.id === ghostId);
    if (!ghost) return;

    try {
      const id = await invoke<string>('create_session', {
        tool: ghost.tool,
        cwd: ghost.cwd,
        initialPrompt: null,
      });

      // Check if tmux is available
      let tmuxName: string | undefined;
      try {
        const tmuxAvailable = await invoke<boolean>('check_tmux');
        if (tmuxAvailable) {
          tmuxName = `vcc-${id}`;
        }
      } catch {
        // Ignore
      }

      const session: SessionInfo = {
        id,
        tool: ghost.tool,
        cwd: ghost.cwd,
        label: ghost.label,
        status: 'running',
        created_at: Date.now(),
        position: ghost.position,
        tmuxName,
      };

      useSessionStore.getState().relaunchGhost(ghostId, session);
      return session;
    } catch (err) {
      console.error('Failed to relaunch session:', err);
      throw err;
    }
  }

  // Reattach to a live tmux ghost session
  async function reattachSession(ghostId: string) {
    const ghost = useSessionStore.getState().sessions.find((s) => s.id === ghostId);
    if (!ghost || !ghost.tmuxName) {
      console.error('Cannot reattach: ghost not found or no tmuxName');
      return;
    }

    try {
      const id = await invoke<string>('reattach_session', {
        id: ghost.id,
        tmuxName: ghost.tmuxName,
        tool: ghost.tool,
        cwd: ghost.cwd,
      });

      const session: SessionInfo = {
        id,
        tool: ghost.tool,
        cwd: ghost.cwd,
        label: ghost.label,
        status: 'running',
        created_at: Date.now(),
        position: ghost.position,
        tmuxName: ghost.tmuxName,
        taskTitle: ghost.taskTitle,
        previewUrl: ghost.previewUrl,
      };

      useSessionStore.getState().reattachGhost(ghostId, session);
      useSessionStore.getState().setRenderMode(id, 'terminal');
      return session;
    } catch (err) {
      console.error('Failed to reattach session:', err);
      throw err;
    }
  }

  // Discover surviving tmux sessions and mark live ghosts
  async function discoverTmuxSessions() {
    try {
      const discovered = await invoke<TmuxSessionInfo[]>('discover_sessions');
      if (discovered.length > 0) {
        useSessionStore.getState().markLiveGhosts(discovered);
      }
    } catch (err) {
      console.error('Failed to discover tmux sessions:', err);
    }
  }

  return {
    createSession,
    createStructuredSession,
    closeSession,
    killSession,
    killStructuredSession,
    killTmuxSessionByName,
    writeToSession,
    resizeSession,
    relaunchSession,
    reattachSession,
    discoverTmuxSessions,
  };
}
