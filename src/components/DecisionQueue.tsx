import { useState, useEffect, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useCardStore, type DecisionCard as DecisionCardType } from '../stores/cardStore';
import DecisionCard from './DecisionCard';
import type { useClockwork as UseClockworkType } from '../hooks/useClockwork';

interface DecisionQueueProps {
  onViewCanvas: () => void;
  clockwork: ReturnType<typeof UseClockworkType>;
  onSendToReviewer?: (card: DecisionCardType, message: string) => void;
}

export default function DecisionQueue({ onViewCanvas, clockwork, onSendToReviewer }: DecisionQueueProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const cards = useCardStore((s) => s.cards);
  const [handledCount, setHandledCount] = useState(0);

  const liveSessions = sessions.filter((s) => !s.isGhost);

  // Load handled count on mount and periodically
  useEffect(() => {
    clockwork.getHandledCountToday().then(setHandledCount);
    const interval = setInterval(() => {
      clockwork.getHandledCountToday().then(setHandledCount);
    }, 30_000); // Refresh every 30s
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResolve = useCallback(
    (card: DecisionCardType, instruction: string) => {
      clockwork.resolveCard(card, instruction);
      setHandledCount((c) => c + 1);
    },
    [clockwork]
  );

  const handleSwitchToFounder = useCallback(() => {
    onViewCanvas();
  }, [onViewCanvas]);

  const handleSendToReviewer = useCallback(
    (card: DecisionCardType, message: string) => {
      if (onSendToReviewer) {
        onSendToReviewer(card, message);
      }
    },
    [onSendToReviewer]
  );

  return (
    <div className="decision-queue">
      {/* Header */}
      <div className="decision-queue-header">
        <div className="decision-queue-status">
          <span className="status-count">{liveSessions.length}</span> session{liveSessions.length !== 1 ? 's' : ''} running.
          {handledCount > 0 && (
            <> Reviewer handled <span className="status-count">{handledCount}</span> decision{handledCount !== 1 ? 's' : ''} today.</>
          )}
        </div>
      </div>

      {/* Card list */}
      <div className="decision-queue-cards">
        {cards.length > 0 ? (
          cards.map((card) => (
            <DecisionCard
              key={card.id}
              card={card}
              onResolve={handleResolve}
              onSwitchToFounder={handleSwitchToFounder}
              onSendToReviewer={handleSendToReviewer}
            />
          ))
        ) : (
          <div className="decision-queue-empty">
            <div className="empty-icon">~</div>
            <div className="empty-title">Nothing needs you.</div>
            <div className="empty-subtitle">
              {liveSessions.length > 0
                ? `${liveSessions.length} session${liveSessions.length !== 1 ? 's' : ''} running smoothly.`
                : 'No active sessions.'}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="decision-queue-footer">
        <button className="decision-queue-canvas-btn" onClick={onViewCanvas}>
          View Canvas
        </button>
      </div>
    </div>
  );
}
