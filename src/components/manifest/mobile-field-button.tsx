import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MobileFieldTone = "neutral" | "success" | "info" | "warning" | "danger";

const toneClasses: Record<
  MobileFieldTone,
  { idle: string; active: string; badge: string }
> = {
  neutral: {
    idle: "border-border bg-card/80 text-foreground",
    active: "border-primary bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40",
    badge: "bg-primary-foreground/20 text-primary-foreground",
  },
  success: {
    idle: "border-success/40 bg-card/80 text-foreground",
    active: "border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40",
    badge: "bg-success-foreground/20 text-success-foreground",
  },
  info: {
    idle: "border-info/40 bg-card/80 text-foreground",
    active: "border-info bg-info text-info-foreground shadow-md ring-2 ring-info/40",
    badge: "bg-info-foreground/20 text-info-foreground",
  },
  warning: {
    idle: "border-warning/40 bg-card/80 text-foreground",
    active: "border-warning bg-warning text-warning-foreground shadow-md ring-2 ring-warning/40",
    badge: "bg-warning-foreground/20 text-warning-foreground",
  },
  danger: {
    idle: "border-destructive/40 bg-card/80 text-foreground",
    active: "border-destructive bg-destructive text-destructive-foreground shadow-md ring-2 ring-destructive/40",
    badge: "bg-destructive-foreground/20 text-destructive-foreground",
  },
};

function FieldButtonChrome({
  title,
  subtitle,
  icon,
  active,
  badgeWhenIdle,
  badgeClass,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  active: boolean;
  badgeWhenIdle?: string;
  badgeClass: string;
}) {
  return (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-tight">{title}</span>
        {subtitle && (
          <span
            className={cn(
              "mt-0.5 block text-xs",
              active ? "opacity-95" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </span>
        )}
      </span>
      {active && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            badgeClass,
          )}
        >
          Selected
        </span>
      )}
      {!active && badgeWhenIdle && (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
          {badgeWhenIdle}
        </span>
      )}
    </>
  );
}

/** Large touch target for driver field actions — distinct from green leg-complete CTA. */
export function MobileFieldButton({
  title,
  subtitle,
  icon,
  tone = "neutral",
  active = false,
  disabled,
  onClick,
  className,
  badgeWhenIdle,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: MobileFieldTone;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  /** Small label shown on the right when the button is NOT active (e.g. "Default"). */
  badgeWhenIdle?: string;
  /**
   * Nested control drawn inside the row chrome (e.g. Not attending `UserX`).
   * When set, outer shell is a `div` so the trailing control can be a real `<button>`
   * (valid HTML — no nested buttons). Trailing clicks must not fire `onClick`.
   */
  trailing?: ReactNode;
}) {
  const palette = toneClasses[tone];
  const shellClass = cn(
    "flex w-full min-h-14 touch-manipulation select-none items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition",
    active ? palette.active : palette.idle,
    disabled && "opacity-50",
    className,
  );

  const chrome = (
    <FieldButtonChrome
      title={title}
      subtitle={subtitle}
      icon={icon}
      active={active}
      badgeWhenIdle={badgeWhenIdle}
      badgeClass={palette.badge}
    />
  );

  // Trailing nested action → shell is a div; primary tap area is its own button.
  if (trailing) {
    return (
      <div className={cn(shellClass, "pr-2")}>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.99] disabled:pointer-events-none"
        >
          {chrome}
        </button>
        <div className="shrink-0 self-center">{trailing}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(shellClass, "active:scale-[0.99] disabled:opacity-50")}
    >
      {chrome}
    </button>
  );
}

/** Full-width option row for med status etc. — min 44px touch height. */
export function MobileOptionButton({
  selected,
  label,
  hint,
  dotClassName,
  onClick,
  disabled,
}: {
  selected: boolean;
  label: ReactNode;
  hint?: ReactNode;
  dotClassName?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full min-h-12 touch-manipulation select-none items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left text-sm transition active:scale-[0.99] disabled:opacity-50",
        selected
          ? "border-info bg-info font-semibold text-info-foreground shadow-md ring-2 ring-info/40"
          : "border-border bg-card/80 text-foreground",
      )}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          selected ? "bg-info-foreground" : dotClassName ?? "bg-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && selected && (
          <span className="mt-0.5 block text-xs opacity-95">{hint}</span>
        )}
      </span>
      {selected && (
        <span className="shrink-0 rounded-full bg-info-foreground/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-info-foreground">
          Selected
        </span>
      )}
    </button>
  );
}
