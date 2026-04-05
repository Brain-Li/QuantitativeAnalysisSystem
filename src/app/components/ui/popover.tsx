import * as React from "react";
import { cn } from "./utils";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error("Popover components must be used within <Popover>");
  return ctx;
}

interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Popover({ open: controlledOpen, onOpenChange, children }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </PopoverContext.Provider>
  );
}

const PopoverTrigger = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"button"> & { asChild?: boolean }
>(({ children, asChild, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopoverContext();

  const handleRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      ...props,
      ref: handleRef,
      onClick: (e: React.MouseEvent) => {
        (children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>).props.onClick?.(e);
        onClick?.(e as React.MouseEvent<HTMLButtonElement>);
        setOpen(!open);
      },
      "data-state": open ? "open" : "closed",
    });
  }

  return (
    <button
      ref={handleRef as React.Ref<HTMLButtonElement>}
      data-slot="popover-trigger"
      data-state={open ? "open" : "closed"}
      onClick={(e) => {
        onClick?.(e);
        setOpen(!open);
      }}
      {...props}
    >
      {children}
    </button>
  );
});
PopoverTrigger.displayName = "PopoverTrigger";

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    align?: "start" | "center" | "end";
    sideOffset?: number;
    side?: "top" | "bottom" | "left" | "right";
  }
>(({ className, align = "center", sideOffset = 4, side = "bottom", children, ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopoverContext();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useImperativeHandle(ref, () => contentRef.current!);

  // Close when clicking outside
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  const alignClass =
    align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <div
      ref={contentRef}
      data-slot="popover-content"
      data-state={open ? "open" : "closed"}
      style={{ marginTop: sideOffset }}
      className={cn(
        "absolute z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden",
        "animate-in fade-in-0 zoom-in-95",
        side === "bottom" && "top-full mt-1",
        side === "top" && "bottom-full mb-1",
        alignClass,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
PopoverContent.displayName = "PopoverContent";

const PopoverAnchor = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ ...props }, ref) => <div ref={ref} data-slot="popover-anchor" {...props} />
);
PopoverAnchor.displayName = "PopoverAnchor";

// Wrapper to provide relative positioning context
function PopoverWrapper({ children }: { children: React.ReactNode }) {
  return <div className="relative inline-block">{children}</div>;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverWrapper };
