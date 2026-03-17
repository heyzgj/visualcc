import type { OutcomeInfo } from '../types/session';

interface OutcomeCardProps {
  outcome: OutcomeInfo;
  sessionId: string;
  status: 'done' | 'error';
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default function OutcomeCard({ outcome, status }: OutcomeCardProps) {
  return (
    <div className={`outcome-card outcome-card--${status}`}>
      <div className="outcome-icon">
        {status === 'done' ? '✓' : '✕'}
      </div>
      <div className="outcome-details">
        <div className="outcome-summary">{outcome.summary}</div>
        <div className="outcome-meta">
          {outcome.filesChanged !== undefined && (
            <span className="outcome-meta-item">
              {outcome.filesChanged} file{outcome.filesChanged !== 1 ? 's' : ''} changed
            </span>
          )}
          <span className="outcome-meta-item">
            {formatDuration(outcome.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
