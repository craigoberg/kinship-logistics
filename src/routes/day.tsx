import { createFileRoute, Navigate } from "@tanstack/react-router";
import { DayCentrePage } from "@/components/site-day/day-centre-page";
import { useAuthReady } from "@/hooks/use-auth-ready";

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
  const { user, isReady } = useAuthReady();

  if (!isReady) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6 text-sm text-muted-foreground">
        Restoring session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" search={{ redirect: "/day" }} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Day Centre</h1>
        <p className="text-sm text-muted-foreground">
          Start of Day declaration, RYGE issues register, dual-PIN site
          escalation and end-of-day billing handover.
        </p>
      </header>
      <DayCentrePage />
    </div>
  );
}
