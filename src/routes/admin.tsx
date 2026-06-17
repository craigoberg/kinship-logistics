import { createFileRoute } from "@tanstack/react-router";
import { AdminLookupWorkspace } from "@/components/admin/admin-lookup-workspace";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage the schema-driven lookup parameters powering every operational
          dropdown across the platform.
        </p>
      </header>
      <AdminLookupWorkspace />
    </div>
  );
}
