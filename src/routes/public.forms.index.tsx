import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CmsPageView } from "@/components/public/cms-page-view";
import { getPublishedPageBySlug } from "@/lib/api/public-cms";
import { listPublicFormDefinitions } from "@/lib/api/public-forms";

export const Route = createFileRoute("/public/forms/")({
  ssr: false,
  component: PublicFormsIndex,
});

function PublicFormsIndex() {
  const pageQ = useQuery({
    queryKey: ["cms-page", "forms"],
    queryFn: () => getPublishedPageBySlug("forms"),
  });
  const formsQ = useQuery({
    queryKey: ["public-forms", "public"],
    queryFn: () => listPublicFormDefinitions({ channel: "public" }),
  });

  const formsByKey = Object.fromEntries(
    (formsQ.data ?? []).map((f) => [f.formKey, f]),
  );

  if (pageQ.data) {
    return <CmsPageView page={pageQ.data} formsByKey={formsByKey} />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Forms</h1>
      <ul className="grid gap-2 sm:grid-cols-2">
        {(formsQ.data ?? []).map((f) => (
          <li key={f.formKey}>
            <a
              href={`/public/forms/${f.formKey}`}
              className="block rounded-md border border-stone-300 bg-white px-3 py-3 text-sm font-medium"
            >
              {f.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
