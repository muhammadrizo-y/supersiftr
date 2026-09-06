import { Switch } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function SwitchPrimitive({
  className,
  ...props
}: Switch.Root.Props & { className?: string }) {
  return (
    <Switch.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-sm transition-colors outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/60",
        className,
      )}
      {...props}
    >
      <Switch.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0"
      />
    </Switch.Root>
  );
}

export { SwitchPrimitive as Switch };