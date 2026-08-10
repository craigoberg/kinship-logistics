import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/public/forms")({
  ssr: false,
  component: () => <Outlet />,
});
