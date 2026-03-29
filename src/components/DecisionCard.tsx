import { useState, useCallback } from 'react';
import type { DecisionCard as DecisionCardType } from '../stores/cardStore';
import { useCardStore } from '../stores/cardStore';

interface DecisionCardProps {
  card: DecisionCardType;
  onResolve: (card: DecisionCardType, instruction: string) => void;
  onSendToReviewer?: (card: DecisionCardType, message: string) => void;
  onSwitchToFounder?: () => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function DecisionCard({
  card,
  onResolve,
  onSendToReviewer,
  onSwitchToFounder,
}: DecisionCardProps) {
  const [customText, setCustomText] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const updateCard = useCardStore((s) => s.updateCard);

  const handleOptionClick = useCallback(
    (option: { label: string; description: string }) => {
      onResolve(card, option.label + ': ' + option.description);
    },
    [card, onResolve]
  );

  const handleCustomSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!customText.trim()) return;

      if (card.exchangeCount < 2 && onSendToReviewer) {
        // Send to Reviewer for follow-up
        updateCard(card.id, {
          exchangeCount: card.exchangeCount + 1,
          isWaiting: true,
        });
        onSendToReviewer(card, customText.trim());
        setCustomText('');
      } else if (onSwitchToFounder) {
        // Max exchanges reached
        onSwitchToFounder();
      }
    },
    [card, customText, onSendToReviewer, onSwitchToFounder, updateCard]
  );

  if (card.isWaiting) {
    return (
      <div className="decision-card decision-card--waiting">
        <div className="decision-card-header">
          <span className="decision-card-project">{card.project}</span>
          <span className="decision-card-time">{timeAgo(card.createdAt)}</span>
        </div>
        <div className="decision-card-title">{card.title}</div>
        <div className="decision-card-waiting-text">
          <span className="waiting-spinner" />
          Waiting for Reviewer...
        </div>
      </div>
    );
  }

  return (
    <div
      className={`decision-card ${card.isTasteDecision ? 'decision-card--taste' : ''}`}
    >
      {/* Header */}
      <div className="decision-card-header">
        <span className="decision-card-project">{card.project}</span>
        <span className="decision-card-time">{timeAgo(card.createdAt)}</span>
      </div>

      {/* Title */}
      <div className="decision-card-title">{card.title}</div>

      {/* Context */}
      <div className="decision-card-context">{card.context}</div>

      {/* Options */}
      <div className="decision-card-options">
        {card.options.map((option, i) => (
          <button
            key={i}
            className={`decision-card-option ${
              option.recommended && !card.isTasteDecision
                ? 'decision-card-option--recommended'
                : ''
            }`}
            onClick={() => handleOptionClick(option)}
          >
            <div className="option-label">
              {option.recommended && !card.isTasteDecision && (
                <span className="option-star" title="Recommended">*</span>
              )}
              {option.label}
            </div>
            {option.description && (
              <div className="option-description">{option.description}</div>
            )}
          </button>
        ))}
      </div>

      {/* Reasoning (collapsible) */}
      {card.recommendReasoning && !card.isTasteDecision && (
        <div className="decision-card-reasoning">
          <button
            className="reasoning-toggle"
            onClick={() => setShowReasoning(!showReasoning)}
          >
            {showReasoning ? 'Hide reasoning' : 'Why this recommendation?'}
          </button>
          {showReasoning && (
            <div className="reasoning-content">{card.recommendReasoning}</div>
          )}
        </div>
      )}

      {/* Custom text input */}
      <form className="decision-card-input" onSubmit={handleCustomSubmit}>
        <input
          type="text"
          className="decision-card-text-input"
          placeholder={
            card.exchangeCount >= 2
              ? 'Max exchanges reached. Switch to Founder Mode.'
              : 'Ask the Reviewer something else...'
          }
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          disabled={card.exchangeCount >= 2}
        />
        {card.exchangeCount < 2 ? (
          <button
            type="submit"
            className="decision-card-send-btn"
            disabled={!customText.trim()}
          >
            Send
          </button>
        ) : (
          <button
            type="button"
            className="decision-card-founder-btn"
            onClick={onSwitchToFounder}
          >
            Founder Mode
          </button>
        )}
      </form>
    </div>
  );
}
