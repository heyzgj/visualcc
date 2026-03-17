import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useThemeStore } from '../stores/themeStore';

interface MarkdownPreviewProps {
  content: string;
  sessionId: string;
  onSwitchToTerminal: () => void;
}

export default function MarkdownPreview({ content, onSwitchToTerminal }: MarkdownPreviewProps) {
  const theme = useThemeStore((s) => s.theme);

  if (!content.trim()) {
    return (
      <div className="markdown-preview markdown-preview--empty">
        <div className="markdown-empty-text">Waiting for output...</div>
      </div>
    );
  }

  return (
    <div className="markdown-preview">
      <div className="preview-toolbar">
        <span className="preview-url">Rendered Output</span>
        <div className="preview-toolbar-actions">
          <button
            className="preview-toolbar-btn terminal-toggle"
            onClick={onSwitchToTerminal}
            title="Show terminal"
          >
            ⌨
          </button>
        </div>
      </div>
      <div className="markdown-preview-content">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const codeStr = String(children).replace(/\n$/, '');

              if (match) {
                return (
                  <SyntaxHighlighter
                    style={theme === 'dark' ? oneDark : undefined}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: '8px 0',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  >
                    {codeStr}
                  </SyntaxHighlighter>
                );
              }

              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
