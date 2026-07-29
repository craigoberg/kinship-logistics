import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DayCentrePage } from "@/components/site-day/day-centre-page";
import { OperationalTodayLabel } from "@/components/dev/operational-today-label";
import { IS_TEST_BUILD } from "@/lib/test-mode";

const DIAG_STORAGE_KEY = "dev:day-centre-diagnostic-visible";

function useDiagnosticToggle() {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DIAG_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });

  const toggle = () => {
    setVisible((v) => {
      const next = !v;
      try { localStorage.setItem(DIAG_STORAGE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return { visible, toggle };
}

export const Route = createFileRoute("/day")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Day Centre — Yada Connect" },
      {
        name: "description",
        content:
          "Open/close the Day Centre, log walkthrough anomalies, manage RYGE escalations and Council SLA dispatch.",
      },
    ],
  }),
  component: DayPage,
});

function DayPage() {
  const { visible: showDiagnostic, toggle: toggleDiagnostic } = useDiagnosticToggle();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Day Centre</h1>
          <OperationalTodayLabel
            suffix="Start of Day · issues · dual-PIN escalation · end-of-day billing"
            className="text-sm text-muted-foreground"
          />
        </div>
        {IS_TEST_BUILD && (
          <button
            type="button"
            onClick={toggleDiagnostic}
            title={showDiagnostic ? "Hide RED blocking diagnostic" : "Show RED blocking diagnostic"}
            className="mt-0.5 shrink-0 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
          >
            {showDiagnostic ? "Hide diag" : "Show diag"}
          </button>
        )}
      </header>
      <DayCentrePage showDiagnostic={showDiagnostic} />
    </div>
  );
}
