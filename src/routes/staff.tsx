import { createFileRoute } from "@tanstack/react-router";
import { DirectoryWorkspace } from "@/components/directory/directory-workspace";

export const Route = createFileRoute("/staff")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Staff & Support Directory — Yada Connect" },
      {
        name: "description",
        content:
          "Manage staff, volunteers, carers and support networks linked to participants.",
      },
    ],
  }),
  component: StaffPage,
});

function StaffPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
          Staff &amp; Support Directory
        </h2>
        <p className="text-sm text-muted-foreground">
          Personnel rosters and the support network surrounding each participant.
        </p>
      </header>

      <DirectoryWorkspace />
    </div>
  );
}
