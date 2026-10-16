import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PublicFormPanel } from "@/components/public/public-form-panel";
import { listPublicFormDefinitions } from "@/lib/api/public-forms";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rights-voice")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Rights & voice — Yada Connect" },
      {
        name: "description",
        content:
          "Complaints, enquiries, feedback, compliments and volunteer interest — Hub-tracked.",
      },
    ],
  }),
  component: RightsVoicePage,
});

/** BL-112 — Connect kiosk / office-assisted forms (same definitions as public). */
function RightsVoicePage() {
  const { data: forms = [], isLoading, error } = useQuery({
    queryKey: ["public-forms", "connect"],
    queryFn: () => listPublicFormDefinitions({ channel: "connect" }),
  });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = forms.find((f) => f.formKey === activeKey) ?? forms[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Rights &amp; voice</h1>
        <p className="text-sm text-muted-foreground">
          Office or kiosk submissions use the same forms as{" "}
          <span className="font-medium">yada.org.au</span>. Every submit creates a
          Governance Hub ticket (including anonymous complaints).
        </p>
      </header>

      {isLoading ? <p className="text-sm">Loading forms…</p> : null}
      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {forms.map((f) => (
          <Button
            key={f.formKey}
            type="button"
            size="sm"
            variant={
              (activeKey ?? forms[0]?.formKey) === f.formKey
                ? "default"
                : "outline"
            }
            className={cn("gap-1")}
            onClick={() => setActiveKey(f.formKey)}
          >
            {f.title}
          </Button>
        ))}
      </div>

      {active ? (
        <div className="rounded-lg border bg-card p-4">
          <PublicFormPanel
            definition={active}
            channel="connect"
            policyHref="/public/policies"
          />
        </div>
      ) : null}
    </div>
  );
}
