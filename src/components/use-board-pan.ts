"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/** Pan board whitespace without taking clicks away from headers or card controls. */
export function useBoardPan() {
  const pan = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as Element).closest("button, a, input, select, textarea, [role='button'], [contenteditable='true'], .opportunity-card, .live-card, .thought-note")) return;
    pan.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
    // Capturing on pointerdown retargets even stationary clicks to the viewport,
    // preventing column headers from receiving their native double-click event.
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    if (!current.moved && Math.abs(delta) < 4) return;
    if (!current.moved) {
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.panning = "true";
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = current.scrollLeft - delta;
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    suppressClick.current = current.moved;
    pan.current = null;
    delete event.currentTarget.dataset.panning;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function blockClickAfterPan(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    onPointerDownCapture: () => { suppressClick.current = false; },
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerCancel: endPan,
    onLostPointerCapture: endPan,
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => { if (!pan.current?.moved) endPan(event); },
    onClickCapture: blockClickAfterPan,
    onDoubleClickCapture: blockClickAfterPan,
  };
}
