import * as React from "react";
import { cn } from "./utils";

const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<"input">, "type" | "checked" | "onChange"> & {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (checked: boolean | "indeterminate") => void;
    className?: string;
  }
>(({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
  const isIndeterminate = checked === "indeterminate";
  const isChecked = checked === true;

  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(ref, () => inputRef.current!);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  return (
    <div className="relative inline-flex items-center justify-center">
      <input
        ref={inputRef}
        type="checkbox"
        checked={isIndeterminate ? false : isChecked}
        onChange={(e) => {
          if (onCheckedChange) {
            onCheckedChange(e.target.checked);
          }
        }}
        disabled={disabled}
        className="sr-only"
        {...props}
      />
      <div
        onClick={() => {
          if (!disabled && onCheckedChange) {
            onCheckedChange(isIndeterminate ? false : !isChecked);
          }
        }}
        data-slot="checkbox"
        data-state={isIndeterminate ? "indeterminate" : isChecked ? "checked" : "unchecked"}
        className={cn(
          "size-4 shrink-0 rounded-[4px] border-2 flex items-center justify-center cursor-pointer transition-all",
          (isChecked || isIndeterminate)
            ? "border-primary bg-primary"
            : "border-muted-foreground/40 bg-background hover:border-muted-foreground/60",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        {isIndeterminate && (
          <div className="w-2 h-0.5 bg-white rounded-full" />
        )}
        {isChecked && !isIndeterminate && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6L5 9L10 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
});
Checkbox.displayName = "Checkbox";

export { Checkbox };
