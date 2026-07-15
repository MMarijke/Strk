import React, { useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 72; // px needed to trigger refresh

export default function PullToRefresh({ onRefresh, children }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const el = containerRef.current;
    if (el && el.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      // Dampen pull distance
      setPullY(Math.min(delta * 0.45, THRESHOLD + 16));
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (pullY >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullY(THRESHOLD);
      await onRefresh();
      setRefreshing(false);
    }
    setPullY(0);
    startY.current = null;
  }, [pullY, refreshing, onRefresh]);

  const progress = Math.min(pullY / THRESHOLD, 1);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Indicator */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10 transition-opacity"
        style={{
          top: 0,
          height: `${pullY}px`,
          opacity: progress,
        }}
      >
        <div className={cn(
          "w-8 h-8 rounded-full bg-card border border-border shadow flex items-center justify-center",
          refreshing && "animate-spin"
        )}>
          <RefreshCw
            className="w-4 h-4 text-primary"
            style={{ transform: `rotate(${progress * 180}deg)`, transition: refreshing ? "none" : "transform 0.1s" }}
          />
        </div>
      </div>

      {/* Content shifted down while pulling */}
      <div style={{ transform: `translateY(${pullY}px)`, transition: pullY === 0 ? "transform 0.25s ease" : "none" }}>
        {children}
      </div>
    </div>
  );
}