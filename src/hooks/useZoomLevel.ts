import { useState, useCallback, useRef } from 'react';
import type { Viewport } from '@xyflow/react';

export type ZoomTier = 'compact' | 'thumbnail' | 'interactive' | 'focused';

const STORAGE_KEY = 'visualcc-viewport';

function loadViewport(): Viewport {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { x: 0, y: 0, zoom: 1 };
}

function getTier(z: number): ZoomTier {
  if (z < 0.3) return 'compact';
  if (z < 0.7) return 'thumbnail';
  if (z < 0.9) return 'interactive';
  return 'focused';
}

export function useZoomLevel() {
  const savedViewport = useRef(loadViewport());
  const [zoom, setZoom] = useState(savedViewport.current.zoom);
  const [tier, setTier] = useState<ZoomTier>(getTier(savedViewport.current.zoom));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onViewportChange = useCallback((viewport: Viewport) => {
    setZoom(viewport.zoom);
    setTier(getTier(viewport.zoom));

    // Debounce save — write to localStorage at most every 500ms
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(viewport));
    }, 500);
  }, []);

  return { zoom, tier, defaultViewport: savedViewport.current, onViewportChange };
}
