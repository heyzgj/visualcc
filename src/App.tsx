import { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Canvas from './components/Canvas';
import Toolbar, { CanvasToolbar } from './components/Toolbar';
import NewSessionDialog from './components/NewSessionDialog';
import DecisionQueue from './components/DecisionQueue';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from './stores/sessionStore';
import { useCardStore } from './stores/cardStore';
import { useSessionEvents, type SessionEvent } from './hooks/useSessionEvents';
import { useReviewerSession } from './hooks/useReviewerSession';
import { useClockwork } from './hooks/useClockwork';
import { useSession } from './hooks/useSession';

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
  const { discoverTmuxSessions } = useSession();

  // Unified session event detection (replaces useStatusDetector + useOutputIntelligence)
  useSessionEvents();

  // Reviewer session management (for Vacation Mode)
  const reviewer = useReviewerSession();

  // Clockwork file coordination (watches outbox/ and cards/ directories)
  const clockwork = useClockwork();

  // Wire up signal resolver: clockwork signals reviewer when response files arrive
  useEffect(() => {
    clockwork.setSignalResolver(reviewer.signalResponse);
    return () => { clockwork.setSignalResolver(null); };
  }, [clockwork, reviewer.signalResponse]);

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
      } else if (event.type === 'resumed') {
        // Reset circuit breaker when worker resumes working
        clockwork.recordResolution(event.sessionId);
        reviewer.routeEvent(event);
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

  // On startup: discover surviving tmux sessions and mark live ghosts
  useEffect(() => {
    discoverTmuxSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            clockwork={clockwork}
            onSendToReviewer={(card, text) => {
              useCardStore.getState().updateCard(card.id, { isWaiting: true, exchangeCount: card.exchangeCount + 1 });
              const reviewerSessionId = useSessionStore.getState().reviewerSessionId;
              if (reviewerSessionId) {
                const msg = `Owner responded to card "${card.title}" (session ${card.sessionId}):\n"${text}"\n\nPlease either resolve by writing to outbox, or create an updated card.`;
                invoke('write_to_session', { id: reviewerSessionId, data: msg + '\n' }).catch(console.error);
              }
            }}
          />
          <Toolbar />
        </>
      )}
    </>
  );
}
