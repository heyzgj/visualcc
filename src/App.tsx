import { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Canvas from './components/Canvas';
import Toolbar, { CanvasToolbar } from './components/Toolbar';
import NewSessionDialog from './components/NewSessionDialog';
import DecisionQueue from './components/DecisionQueue';
import { useSessionStore } from './stores/sessionStore';
import { useSessionEvents, type SessionEvent } from './hooks/useSessionEvents';
import { useReviewerSession } from './hooks/useReviewerSession';
import { useClockwork } from './hooks/useClockwork';

import './styles/theme.css';
import './styles/canvas.css';
import './styles/tiles.css';
import './styles/dialogs.css';
import './styles/chat.css';
import './styles/preview.css';
import './styles/vacation.css';

export default function App() {
  const showNewDialog = useSessionStore((s) => s.showNewDialog);
  const mode = useSessionStore((s) => s.mode);

  // Unified session event detection (replaces useStatusDetector + useOutputIntelligence)
  useSessionEvents();

  // Reviewer session management (for Vacation Mode)
  const reviewer = useReviewerSession();

  // Clockwork file coordination (watches outbox/ and cards/ directories)
  const clockwork = useClockwork();

  // Event router: routes session events based on current mode
  const handleSessionEvent = useCallback((event: SessionEvent) => {
    const state = useSessionStore.getState();

    if (state.mode === 'founder') {
      // In Founder Mode, just log events
      state.addFounderEvent({
        ts: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        sessionId: event.sessionId,
        event: event.type,
        detail: event.type === 'blocked'
          ? (event.lastLines[event.lastLines.length - 1] ?? 'idle')
          : event.type === 'errored'
          ? event.error.slice(0, 100)
          : event.type === 'completed'
          ? (event.lastLines[event.lastLines.length - 1] ?? 'done')
          : 'resumed',
      });
    } else {
      // In Vacation Mode, route to reviewer (with circuit breaker)
      if (event.type === 'blocked') {
        if (clockwork.isCircuitBroken(event.sessionId)) {
          clockwork.generateDirectCard(event);
        } else {
          clockwork.recordBlock(event.sessionId);
          reviewer.routeEvent(event);
        }
      } else {
        reviewer.routeEvent(event);
      }
    }
  }, [reviewer, clockwork]);

  // Register event callback
  useEffect(() => {
    useSessionStore.getState().setOnSessionEvent(handleSessionEvent);
    return () => {
      useSessionStore.getState().setOnSessionEvent(null);
    };
  }, [handleSessionEvent]);

  return (
    <>
      {mode === 'founder' ? (
        <ReactFlowProvider>
          <Canvas />
          <Toolbar>
            <CanvasToolbar />
          </Toolbar>
          {showNewDialog && <NewSessionDialog />}
        </ReactFlowProvider>
      ) : (
        <>
          <DecisionQueue
            onViewCanvas={() => useSessionStore.getState().setMode('founder')}
          />
          <Toolbar />
        </>
      )}
    </>
  );
}
