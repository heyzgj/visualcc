import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownBlockProps {
  text: string;
}

const customStyle: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...((oneDark as Record<string, React.CSSProperties>)['pre[class*="language-"]'] ?? {}),
    background: 'var(--bg-deep)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-subtle)',
    margin: '8px 0',
    padding: '12px',
    fontSize: '12px',
  },
  'code[class*="language-"]': {
    ...((oneDark as Record<string, React.CSSProperties>)['code[class*="language-"]'] ?? {}),
    background: 'transparent',
    fontFamily: "var(--font-mono)",
    fontSize: '12px',
  },
};

function MarkdownBlockComponent({ text }: MarkdownBlockProps) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');

            if (match) {
              return (
                <div className="chat-code-block">
                  <div className="code-header">
                    <span className="code-lang">{match[1]}</span>
                    <button
                      className="code-copy"
                      onClick={() => navigator.clipboard.writeText(codeString)}
                    >
                      Copy
                    </button>
                  </div>
                  <SyntaxHighlighter
                    style={customStyle}
                    language={match[1]}
                    PreTag="div"
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            return (
              <code className="chat-inline-code" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBlockComponent);
