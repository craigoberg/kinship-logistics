import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CmsPageView } from "@/components/public/cms-page-view";
import { getPublishedPageBySlug } from "@/lib/api/public-cms";
import { listPublicFormDefinitions } from "@/lib/api/public-forms";

export const Route = createFileRoute("/public/")({
  ssr: false,
  component: PublicHomePage,
});

function PublicHomePage() {
  const pageQ = useQuery({
    queryKey: ["cms-page", "home"],
    queryFn: () => getPublishedPageBySlug("home"),
  });
  const formsQ = useQuery({
    queryKey: ["public-forms", "public"],
    queryFn: () => listPublicFormDefinitions({ channel: "public" }),
  });

  if (pageQ.isLoading) {
    return <p className="text-sm text-stone-600">Loading…</p>;
  }
  if (pageQ.error || !pageQ.data) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">YADA</h1>
        <p className="text-sm text-destructive">
          {(pageQ.error as Error)?.message ??
            "Home page not published yet. Run docs/sql/2026-08-10_public_cms_and_forms.sql and publish from Admin."}
        </p>
        <p>
          <a href="/public/forms" className="underline">
            Forms
          </a>
        </p>
      </div>
    );
  }

  const formsByKey = Object.fromEntries(
    (formsQ.data ?? []).map((f) => [f.formKey, f]),
  );

  return <CmsPageView page={pageQ.data} formsByKey={formsByKey} />;
}
