import { useCallback, useRef, useState } from 'react';

interface PreviewPaneProps {
  url: string;
  sessionId: string;
  onSwitchToTerminal: () => void;
}

export default function PreviewPane({ url, sessionId, onSwitchToTerminal }: PreviewPaneProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadError, setLoadError] = useState(false);

  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      setLoadError(false);
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleOpenExternal = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  return (
    <div className="preview-pane">
      <div className="preview-toolbar">
        <span className="preview-url" title={url}>
          {url}
        </span>
        <div className="preview-toolbar-actions">
          <button
            className="preview-toolbar-btn"
            onClick={handleReload}
            title="Reload preview"
          >
            ↻
          </button>
          <button
            className="preview-toolbar-btn"
            onClick={handleOpenExternal}
            title="Open in browser"
          >
            ↗
          </button>
          <button
            className="preview-toolbar-btn terminal-toggle"
            onClick={onSwitchToTerminal}
            title="Show terminal"
          >
            ⌨
          </button>
        </div>
      </div>
      {loadError ? (
        <div className="preview-error">
          <div className="preview-error-icon">⚠</div>
          <div className="preview-error-text">
            Preview unavailable
          </div>
          <div className="preview-error-hint">
            Dev server at {url} may not be running yet
          </div>
          <button className="preview-error-retry" onClick={handleReload}>
            Retry
          </button>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          className="preview-iframe"
          src={url}
          title={`Preview for session ${sessionId}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onError={() => setLoadError(true)}
        />
      )}
    </div>
  );
}
