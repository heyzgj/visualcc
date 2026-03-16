import { memo, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { claudeAdapter } from '../adapters/claudeAdapter';

interface ChatInputProps {
  sessionId: string;
  supportsInput: boolean;
}

function ChatInputComponent({ sessionId, supportsInput }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text || sending || !supportsInput) return;

    setSending(true);
    try {
      const formatted = claudeAdapter.formatInput(text);
      await invoke('send_message', { id: sessionId, message: formatted });
      setValue('');
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [value, sending, supportsInput, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!supportsInput) {
    return (
      <div className="chat-input-container disabled">
        <span className="chat-input-disabled-text">
          Single-shot session — no interactive input
        </span>
      </div>
    );
  }

  return (
    <div className="chat-input-container">
      <input
        ref={inputRef}
        className="chat-input-field"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        disabled={sending}
      />
      <button
        className="chat-send-btn"
        onClick={handleSend}
        disabled={!value.trim() || sending}
      >
        {sending ? '...' : '↑'}
      </button>
    </div>
  );
}

export default memo(ChatInputComponent);
