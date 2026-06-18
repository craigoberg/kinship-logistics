import { createFileRoute } from "@tanstack/react-router";
import { DirectoryWorkspace } from "@/components/directory/directory-workspace";

export const Route = createFileRoute("/directory")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Team & Support Directory — Yada Connect" },
      {
        name: "description",
        content:
          "Manage staff, volunteers, carers and support networks linked to participants.",
      },
    ],
  }),
  component: DirectoryPage,
});

function DirectoryPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
          Team &amp; Support Directory
        </h2>
        <p className="text-sm text-muted-foreground">
          Personnel rosters and the support network surrounding each participant.
        </p>
      </header>

      <DirectoryWorkspace />
    </div>
  );
}
