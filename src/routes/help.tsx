import { createFileRoute } from "@tanstack/react-router";
import { HelpPage } from "@/components/help/help-page";

export const Route = createFileRoute("/help")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Help — Yada Connect" },
      {
        name: "description",
        content: "Searchable how-to guides for Alpha operational flows.",
      },
    ],
  }),
  component: HelpPage,
});
