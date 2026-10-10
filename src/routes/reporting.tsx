import { createFileRoute } from "@tanstack/react-router";
import { ReportingPage } from "@/components/reporting/reporting-page";

export const Route = createFileRoute("/reporting")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reporting — Yada Connect" },
      {
        name: "description",
        content: "Board reports drawn live from the Hub.",
      },
    ],
  }),
  component: ReportingPage,
});
