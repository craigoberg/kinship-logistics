import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { listCmsNav } from "@/lib/api/public-cms";

export const Route = createFileRoute("/public")({
  ssr: false,
  component: PublicLayout,
});

function PublicLayout() {
  const { data: nav = [] } = useQuery({
    queryKey: ["cms-nav-public"],
    queryFn: () => listCmsNav(true),
    staleTime: 60_000,
  });

  return (
    <PublicSiteShell nav={nav}>
      <Outlet />
    </PublicSiteShell>
  );
}
