import { ReactFlowProvider } from '@xyflow/react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import NewSessionDialog from './components/NewSessionDialog';
import { useSessionStore } from './stores/sessionStore';

import './styles/theme.css';
import './styles/canvas.css';
import './styles/tiles.css';
import './styles/dialogs.css';
import './styles/chat.css';

export default function App() {
  const showNewDialog = useSessionStore((s) => s.showNewDialog);

  return (
    <ReactFlowProvider>
      <Canvas />
      <Toolbar />
      {showNewDialog && <NewSessionDialog />}
    </ReactFlowProvider>
  );
}
