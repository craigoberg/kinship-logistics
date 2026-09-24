import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CmsPageView } from "@/components/public/cms-page-view";
import { getPublishedPageBySlug } from "@/lib/api/public-cms";
import { listPublicFormDefinitions } from "@/lib/api/public-forms";

export const Route = createFileRoute("/public/$slug")({
  ssr: false,
  component: PublicSlugPage,
});

function PublicSlugPage() {
  const { slug } = Route.useParams();
  // forms handled by /public/forms/*
  if (slug === "forms") {
    return (
      <p className="text-sm">
        <a href="/public/forms" className="underline">
          Go to forms
        </a>
      </p>
    );
  }

  const pageQ = useQuery({
    queryKey: ["cms-page", slug],
    queryFn: () => getPublishedPageBySlug(slug),
  });
  const formsQ = useQuery({
    queryKey: ["public-forms", "public"],
    queryFn: () => listPublicFormDefinitions({ channel: "public" }),
  });

  if (pageQ.isLoading) return <p className="text-sm">Loading…</p>;
  if (pageQ.error || !pageQ.data) {
    return (
      <p className="text-sm text-destructive">
        {(pageQ.error as Error)?.message ?? "Page not found or not published."}
      </p>
    );
  }

  const formsByKey = Object.fromEntries(
    (formsQ.data ?? []).map((f) => [f.formKey, f]),
  );

  return <CmsPageView page={pageQ.data} formsByKey={formsByKey} />;
}
