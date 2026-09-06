import type { ReactNode } from "react";
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
  const [thumb, setThumb] = useState({ top: 0, height: 0 });
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);

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
      const maxTop = clientHeight - height;
      const ratio = scrollHeight - clientHeight || 1;
      setThumb({ top: (scrollTop / ratio) * maxTop, height });
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

  const show = thumb.height > 0 && (scrolled || hovered);

  return (
    <div
      className={cn("relative min-h-0 min-w-0", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
        className="pointer-events-none absolute inset-y-0 right-0 w-2.5"
        aria-hidden="true"
      >
        <div
          className={cn(
            "absolute rounded-full bg-foreground/25 transition-[width,background-color,opacity] duration-200",
            hovered ? "w-1.5 bg-foreground/40" : "w-1"
          )}
          style={{ top: thumb.top, right: 3, height: thumb.height, opacity: show ? 1 : 0 }}
        />
      </div>
    </div>
  );
}

export { ScrollArea };