import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import SessionNode from './SessionNode';
import { useSessionStore } from '../stores/sessionStore';
import { useZoomLevel } from '../hooks/useZoomLevel';

const nodeTypes = {
  session: SessionNode,
};

const DEFAULT_TILE_SIZE = { width: 560, height: 420 };

export default function Canvas() {
  const sessions = useSessionStore((s) => s.sessions);
  const renderModes = useSessionStore((s) => s.renderModes);
  const tileSizes = useSessionStore((s) => s.tileSizes);
  const updatePosition = useSessionStore((s) => s.updatePosition);
  const { zoom, tier, defaultViewport, onViewportChange } = useZoomLevel();
  const { fitView, setCenter } = useReactFlow();

  // Escape key → zoom to fit all sessions
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const currentSessions = useSessionStore.getState().sessions;
        if (currentSessions.length > 0) {
          fitView({ padding: 0.15, duration: 400 });
        } else {
          setCenter(400, 300, { zoom: 1, duration: 300 });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitView, setCenter]);

  // Double-click a tile → zoom to fill it
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      fitView({ nodes: [{ id: node.id }], padding: 0.3, duration: 400 });
    },
    [fitView]
  );

  const nodes: Node[] = useMemo(
    () =>
      sessions.map((session) => {
        const tileSize = tileSizes[session.id] ?? DEFAULT_TILE_SIZE;

        return {
          id: session.id,
          type: 'session',
          position: session.position,
          width: tileSize.width,
          height: tileSize.height,
          initialWidth: tileSize.width,
          initialHeight: tileSize.height,
          style: {
            width: tileSize.width,
            height: tileSize.height,
          },
          data: {
            ...session,
            zoomTier: tier,
            renderMode: renderModes[session.id] ?? 'chat',
            tileSize,
          },
          dragHandle: '.tile-header',
        };
      }),
    [sessions, tier, renderModes, tileSizes]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Handle position changes from dragging
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updatePosition(change.id, change.position.x, change.position.y);
        }
      }
    },
    [updatePosition]
  );

  const minimapNodeColor = useCallback(
    (node: Node) => {
      const session = sessions.find((s) => s.id === node.id);
      if (!session) return '#2a2a27';
      const colors: Record<string, string> = {
        running: '#6a9bcc',
        active: '#d97757',
        idle: '#b0aea5',
        error: '#c4443a',
        success: '#788c5d',
        done: '#706f6a',
      };
      return colors[session.status] || '#2a2a27';
    },
    [sessions]
  );

  const minimapNodeStrokeColor = useCallback(
    (node: Node) => {
      const session = sessions.find((s) => s.id === node.id);
      if (!session) return 'rgba(255, 255, 255, 0.08)';
      if (session.isGhost) {
        return 'rgba(176, 174, 165, 0.35)';
      }
      return session.status === 'active' ? 'rgba(217, 119, 87, 0.75)' : 'rgba(255, 255, 255, 0.12)';
    },
    [sessions]
  );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onViewportChange={onViewportChange}
        fitView={false}
        defaultViewport={defaultViewport}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--canvas-dot)"
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          nodeStrokeColor={minimapNodeStrokeColor}
          nodeStrokeWidth={1.5}
          nodeBorderRadius={4}
          maskColor="rgba(217, 119, 87, 0.06)"
          style={{
            background: 'rgba(28, 28, 26, 0.85)',
            borderRadius: 12,
            width: 180,
            height: 120,
          }}
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Status summary — sits above minimap */}
      {sessions.length > 0 && (
        <div className="status-summary">
          {(['running', 'active', 'idle', 'error', 'done'] as const).map((status) => {
            const count = sessions.filter((s) => s.status === status).length;
            if (count === 0) return null;
            return (
              <div key={status} className="status-summary-item">
                <span className={`status-summary-dot ${status}`} />
                <span className="status-summary-count">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Zoom indicator */}
      <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>

      {/* Grain overlay */}
      <div className="canvas-grain" />
    </>
  );
}
