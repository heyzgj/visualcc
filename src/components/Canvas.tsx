import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  type Node,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import SessionNode from './SessionNode';
import { useSessionStore } from '../stores/sessionStore';
import { useZoomLevel, type ZoomTier } from '../hooks/useZoomLevel';

const nodeTypes = {
  session: SessionNode,
};

export default function Canvas() {
  const sessions = useSessionStore((s) => s.sessions);
  const renderModes = useSessionStore((s) => s.renderModes);
  const tileSizes = useSessionStore((s) => s.tileSizes);
  const updatePosition = useSessionStore((s) => s.updatePosition);
  const { zoom, tier, onViewportChange } = useZoomLevel();

  const nodes: Node[] = useMemo(
    () =>
      sessions.map((session) => ({
        id: session.id,
        type: 'session',
        position: session.position,
        data: {
          ...session,
          zoomTier: tier,
          renderMode: renderModes[session.id] ?? 'chat',
          tileSize: tileSizes[session.id] ?? { width: 560, height: 420 },
        },
        dragHandle: '.tile-header',
      })),
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

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onViewportChange={onViewportChange}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
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
          maskColor="rgba(217, 119, 87, 0.08)"
          style={{
            background: 'rgba(28, 28, 26, 0.8)',
            borderRadius: 12,
          }}
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Zoom indicator */}
      <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>

      {/* Grain overlay */}
      <div className="canvas-grain" />
    </>
  );
}
