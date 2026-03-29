import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import NewSessionDialog from './components/NewSessionDialog';
import { useSessionStore } from './stores/sessionStore';
import { useStatusDetector } from './hooks/useStatusDetector';
import { useOutputIntelligence } from './hooks/useOutputIntelligence';
import { useSession } from './hooks/useSession';

import './styles/theme.css';
import './styles/canvas.css';
import './styles/tiles.css';
import './styles/dialogs.css';
import './styles/chat.css';
import './styles/preview.css';

export default function App() {
  const showNewDialog = useSessionStore((s) => s.showNewDialog);
  const { discoverTmuxSessions } = useSession();

  // Global status detection — updates session statuses based on PTY activity
  useStatusDetector();

  // Global output intelligence — parses PTY output for subtitles, URLs, questions
  useOutputIntelligence();

  // On startup: discover surviving tmux sessions and mark live ghosts
  useEffect(() => {
    discoverTmuxSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlowProvider>
      <Canvas />
      <Toolbar />
      {showNewDialog && <NewSessionDialog />}
    </ReactFlowProvider>
  );
}
