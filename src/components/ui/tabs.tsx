import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Yada Connect tab system — Club Ledger high-contrast template.
 *
 * Container scrolls horizontally so long workflow tab labels (Care Profile,
 * Schedules & Attendance, Finance & Ledger, …) never overlap or truncate.
 * Active triggers light up with the teal accent (`bg-tab-active`); inactive
 * triggers are transparent with high-contrast foreground text.
 *
 * Per `.lovable/plan.md` §7 this is the only tab template allowed in
 * multi-step or complex workspace views.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:thin]">
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-11 w-max items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 p-1 text-foreground",
        className,
      )}
      {...props}
    />
  </div>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-transparent px-4 py-1.5 text-sm font-semibold text-foreground/80 ring-offset-background cursor-pointer transition-all hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tab-active focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-tab-active data-[state=active]:text-tab-active-foreground data-[state=active]:shadow-md",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
