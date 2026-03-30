import { useCallback, useState } from 'react';
import { useSessionStore, type AppMode } from '../stores/sessionStore';
import { useCardStore } from '../stores/cardStore';
import { useReviewerSession } from '../hooks/useReviewerSession';

export default function ModeSwitch() {
  const mode = useSessionStore((s) => s.mode);
  const reviewerSessionId = useSessionStore((s) => s.reviewerSessionId);
  const cards = useCardStore((s) => s.cards);
  const reviewer = useReviewerSession();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingCount = cards.length;

  const switchMode = useCallback(
    async (newMode: AppMode) => {
      if (newMode === mode || switching) return;

      const state = useSessionStore.getState();
      setSwitching(true);
      setError(null);

      if (newMode === 'vacation') {
        if (!reviewerSessionId) {
          // First time: start reviewer
          try {
            await reviewer.startReviewer();
          } catch (err) {
            console.error('Failed to start reviewer:', err);
            setError('Failed to start Reviewer session');
            setSwitching(false);
            return;
          }
        } else {
          // Returning: resume with catch-up events
          await reviewer.resumeReviewer();
        }
        state.setMode('vacation');
        state.clearFounderEventLog();
      } else {
        // Switching to Founder Mode
        reviewer.pauseReviewer();
        state.clearFounderEventLog();
        state.setMode('founder');
      }
      setSwitching(false);
    },
    [mode, switching, reviewerSessionId, reviewer]
  );

  return (
    <div className="mode-switch">
      <button
        className={`mode-switch-tab ${mode === 'founder' ? 'active' : ''}`}
        onClick={() => switchMode('founder')}
        disabled={switching}
      >
        Founder Mode
      </button>
      <button
        className={`mode-switch-tab ${mode === 'vacation' ? 'active' : ''}`}
        onClick={() => switchMode('vacation')}
        disabled={switching}
      >
        {switching ? 'Starting...' : 'Vacation Mode'}
        {pendingCount > 0 && (
          <span className="mode-switch-badge">{pendingCount}</span>
        )}
      </button>
      {error && (
        <div className="mode-switch-error">{error}</div>
      )}
    </div>
  );
}
