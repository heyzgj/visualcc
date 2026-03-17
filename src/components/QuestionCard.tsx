import { useState, useCallback } from 'react';
import { useSession } from '../hooks/useSession';
import type { QuestionInfo } from '../types/session';

interface QuestionCardProps {
  question: QuestionInfo;
  sessionId: string;
  onDismiss: () => void;
  onSwitchToTerminal: () => void;
  compact?: boolean;
}

export default function QuestionCard({
  question,
  sessionId,
  onDismiss,
  onSwitchToTerminal,
  compact = false,
}: QuestionCardProps) {
  const { writeToSession } = useSession();
  const [customInput, setCustomInput] = useState('');
  const [sending, setSending] = useState(false);

  const sendAnswer = useCallback(
    async (answer: string) => {
      setSending(true);
      try {
        await writeToSession(sessionId, answer + '\n');
        onDismiss();
      } catch {
        setSending(false);
      }
    },
    [sessionId, writeToSession, onDismiss]
  );

  const handleCustomSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (customInput.trim()) {
        sendAnswer(customInput.trim());
      }
    },
    [customInput, sendAnswer]
  );

  if (compact) {
    return (
      <div className="question-card question-card--compact">
        <div className="question-card-text">{question.text}</div>
        <div className="question-card-buttons">
          {question.type === 'yn' && (
            <>
              <button
                className="question-btn question-btn--yes"
                onClick={() => sendAnswer('y')}
                disabled={sending}
              >
                Y
              </button>
              <button
                className="question-btn question-btn--no"
                onClick={() => sendAnswer('n')}
                disabled={sending}
              >
                N
              </button>
            </>
          )}
          {question.type === 'permission' && (
            <>
              <button
                className="question-btn question-btn--yes"
                onClick={() => sendAnswer('y')}
                disabled={sending}
              >
                ✓
              </button>
              <button
                className="question-btn question-btn--no"
                onClick={() => sendAnswer('n')}
                disabled={sending}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="question-card">
      <div className="question-card-header">
        <span className="question-card-badge">⚠ Input Needed</span>
        <button
          className="question-card-dismiss"
          onClick={onDismiss}
          title="Dismiss"
        >
          &times;
        </button>
      </div>
      <div className="question-card-text">{question.text}</div>
      <div className="question-card-buttons">
        {(question.type === 'yn' || question.type === 'permission') && (
          <>
            <button
              className="question-btn question-btn--yes"
              onClick={() => sendAnswer('y')}
              disabled={sending}
            >
              {question.type === 'permission' ? 'Allow' : 'Yes'}
            </button>
            <button
              className="question-btn question-btn--no"
              onClick={() => sendAnswer('n')}
              disabled={sending}
            >
              {question.type === 'permission' ? 'Deny' : 'No'}
            </button>
          </>
        )}
        {question.type === 'open' && (
          <form className="question-custom-form" onSubmit={handleCustomSubmit}>
            <input
              className="question-custom-input"
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Type your response..."
              autoFocus
              disabled={sending}
            />
            <button
              className="question-btn question-btn--yes"
              type="submit"
              disabled={!customInput.trim() || sending}
            >
              Send
            </button>
          </form>
        )}
        <button
          className="question-btn question-btn--terminal"
          onClick={onSwitchToTerminal}
        >
          See Terminal
        </button>
      </div>
    </div>
  );
}
