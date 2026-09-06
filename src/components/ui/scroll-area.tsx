import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  contentClassName,
  children,
}: {
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 0 });
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      if (scrollHeight <= clientHeight) {
        setThumb({ top: 0, height: 0 });
        return;
      }
      const height = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
      const ratio = scrollHeight - clientHeight || 1;
      setThumb({ top: (scrollTop / ratio) * (clientHeight - height), height });
    };

    const onScroll = () => {
      setScrolled(true);
      update();
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setScrolled(false), 1200);
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(viewport);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    viewport.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearTimeout(hideTimer.current);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = { startY: e.clientY, startTop: viewport.scrollTop };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag) return;
    const ratio = (viewport.scrollHeight - viewport.clientHeight) / viewport.clientHeight;
    viewport.scrollTop = drag.startTop + Math.round((e.clientY - drag.startY) * ratio);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const active = dragging || hovered;
  const show = thumb.height > 0 && (scrolled || hovered || dragging);

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "no-scrollbar h-full overflow-x-hidden overflow-y-auto",
          contentClassName
        )}
      >
        {children}
      </div>
      <div
        className="absolute inset-y-0 right-0 w-2"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-hidden="true"
      >
        <div
          className={cn(
            "absolute rounded-full bg-foreground/25 transition-[width,background-color,opacity] duration-200",
            active ? "w-1.5 bg-foreground/40" : "w-1"
          )}
          style={{
            top: thumb.top,
            height: thumb.height,
            right: active ? 1 : 2,
            opacity: show ? 1 : 0,
          }}
        />
      </div>
    </div>
  );
}

export { ScrollArea };