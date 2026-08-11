"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide eye toggle.
 *
 * Drop-in for `<Input type="password" />` — same props, same `className`
 * (right padding is forced last so a caller's `px-*` can't put text under the
 * button). The wrapper is `relative` only around the input and the button, so
 * this still nests inside an outer `relative` div that owns a leading Lock icon.
 *
 * Each field toggles on its own; when a screen wants password + confirm to
 * reveal together it should keep its own state and pass `show`/`onShowChange`.
 */
export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  /** Controlled reveal state — omit to let the field manage its own. */
  show?: boolean;
  onShowChange?: (show: boolean) => void;
  /** Extra classes for the toggle button. */
  toggleClassName?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, show, onShowChange, toggleClassName, disabled, ...props }, ref) => {
    const [internalShow, setInternalShow] = React.useState(false);
    const visible = show ?? internalShow;

    const toggle = () => {
      const next = !visible;
      setInternalShow(next);
      onShowChange?.(next);
    };

    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          disabled={disabled}
          className={cn(className, "pr-11")}
          {...props}
        />
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className={cn(
            "absolute right-3 top-1/2 -translate-y-1/2 text-cb-ink/30 transition-colors hover:text-cb-ink/60 focus-visible:outline-none focus-visible:text-cb-ink/60 disabled:opacity-40 disabled:cursor-not-allowed",
            toggleClassName
          )}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
