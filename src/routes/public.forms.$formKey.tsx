import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PublicFormPanel } from "@/components/public/public-form-panel";
import { getPublicFormDefinition } from "@/lib/api/public-forms";

export const Route = createFileRoute("/public/forms/$formKey")({
  ssr: false,
  component: PublicFormPage,
});

function PublicFormPage() {
  const { formKey } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-form", formKey],
    queryFn: () => getPublicFormDefinition(formKey),
  });

  if (isLoading) return <p className="text-sm">Loading…</p>;
  if (error || !data || !data.enabledPublic) {
    return (
      <p className="text-sm text-destructive">
        {(error as Error)?.message ?? "This form is not available."}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[#00a3e0]/25 bg-white p-5 text-slate-900 shadow-sm">
      <PublicFormPanel definition={data} channel="public" />
    </div>
  );
}
