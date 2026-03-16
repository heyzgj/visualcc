import { useState, useCallback } from 'react';
import type { Viewport } from '@xyflow/react';

export type ZoomTier = 'compact' | 'thumbnail' | 'interactive' | 'focused';

export function useZoomLevel() {
  const [zoom, setZoom] = useState(1);
  const [tier, setTier] = useState<ZoomTier>('interactive');

  const onViewportChange = useCallback((viewport: Viewport) => {
    const z = viewport.zoom;
    setZoom(z);

    if (z < 0.3) {
      setTier('compact');
    } else if (z < 0.7) {
      setTier('thumbnail');
    } else if (z < 0.9) {
      setTier('interactive');
    } else {
      setTier('focused');
    }
  }, []);

  return { zoom, tier, onViewportChange };
}
