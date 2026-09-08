import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import closeIcon from "@/assets/close.svg?raw";
import maximizeIcon from "@/assets/maximize.svg?raw";
import minimizeIcon from "@/assets/minimize.svg?raw";
import restoreIcon from "@/assets/restore.svg?raw";

import { cn } from "@/lib/utils";

function FluentIcon({ svg, className }: { svg: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: svg.replace(/fill="#212121"/g, 'fill="currentColor"'),
      }}
    />
  );
}

export function WindowControls() {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const update = () => {
      appWindow.isMaximized().then((m) => {
        if (!disposed) setMaximized(m);
      });
    };
    update();
    appWindow.onResized(update).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        tabIndex={-1}
        title="Minimize"
        onClick={() => appWindow.minimize()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        <FluentIcon svg={minimizeIcon} className="size-3.5" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => appWindow.toggleMaximize()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        {maximized ? (
          <FluentIcon svg={restoreIcon} className="size-3" />
        ) : (
          <FluentIcon svg={maximizeIcon} className="size-3" />
        )}
      </button>
      <button
        type="button"
        tabIndex={-1}
        title="Close"
        onClick={() => appWindow.close()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-[#c42b1c] hover:text-white"
      >
        <FluentIcon svg={closeIcon} className="size-3.5" />
      </button>
    </div>
  );
}