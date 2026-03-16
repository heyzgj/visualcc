import { ReactFlowProvider } from '@xyflow/react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import NewSessionDialog from './components/NewSessionDialog';
import { useSessionStore } from './stores/sessionStore';
import { useStatusDetector } from './hooks/useStatusDetector';

import './styles/theme.css';
import './styles/canvas.css';
import './styles/tiles.css';
import './styles/dialogs.css';
import './styles/chat.css';

export default function App() {
  const showNewDialog = useSessionStore((s) => s.showNewDialog);

  // Global status detection — updates session statuses based on PTY activity
  useStatusDetector();

  return (
    <ReactFlowProvider>
      <Canvas />
      <Toolbar />
      {showNewDialog && <NewSessionDialog />}
    </ReactFlowProvider>
  );
}
