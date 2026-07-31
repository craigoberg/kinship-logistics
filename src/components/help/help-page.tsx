import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, CircleHelp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  HELP_TOPICS,
  buildHelpAreaChips,
  filterTopicsByMenu,
  filterTopicsForProfile,
  getHelpTopicById,
  resolveHelpDeepLink,
  searchHelpTopics,
  type HelpTopic,
} from "@/lib/help";

export function HelpPage() {
  const [query, setQuery] = useState("");
  const [menuFilter, setMenuFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState(() => getActiveUserProfile());

  useEffect(() => {
    setProfile(getActiveUserProfile());
  }, []);

  const visibleTopics = useMemo(
    () => filterTopicsForProfile(HELP_TOPICS, profile),
    [profile],
  );

  const areaChips = useMemo(
    () => buildHelpAreaChips(visibleTopics),
    [visibleTopics],
  );

  const results = useMemo(() => {
    const searched = searchHelpTopics(visibleTopics, query);
    return filterTopicsByMenu(searched, menuFilter);
  }, [visibleTopics, query, menuFilter]);

  const selected = selectedId
    ? getHelpTopicById(visibleTopics, selectedId) ??
      getHelpTopicById(HELP_TOPICS, selectedId)
    : null;

  // If soft filter hides a previously selected topic, return to list.
  useEffect(() => {
    if (selectedId && !getHelpTopicById(visibleTopics, selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleTopics]);

  if (selected && canShowTopic(selected, visibleTopics)) {
    return (
      <HelpArticle
        topic={selected}
        allVisible={visibleTopics}
        onBack={() => setSelectedId(null)}
        onOpenRelated={(id) => setSelectedId(id)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            Help
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Searchable how-to guides for Alpha testing. Formal policies and online
          forms will plug into this page later.
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search how-to… e.g. RED, close run, check-in"
          className="h-12 pl-9 pr-10 text-base md:text-base"
          aria-label="Search help topics"
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {areaChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="All"
            active={menuFilter === null}
            onClick={() => setMenuFilter(null)}
          />
          {areaChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              active={menuFilter === chip.key}
              onClick={() =>
                setMenuFilter((prev) => (prev === chip.key ? null : chip.key))
              }
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <p className="text-sm font-medium">No matching topics</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try another word, or clear the area filter.
            </p>
          </div>
        ) : (
          results.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => setSelectedId(topic.id)}
              className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium leading-snug">{topic.title}</span>
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {topic.kind}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{topic.summary}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function canShowTopic(topic: HelpTopic, visible: HelpTopic[]): boolean {
  return visible.some((t) => t.id === topic.id);
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-md border px-3 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted/50",
      )}
    >
      {label}
    </button>
  );
}

function HelpArticle({
  topic,
  allVisible,
  onBack,
  onOpenRelated,
}: {
  topic: HelpTopic;
  allVisible: HelpTopic[];
  onBack: () => void;
  onOpenRelated: (id: string) => void;
}) {
  const navigate = useNavigate();
  const deepLink = resolveHelpDeepLink(topic.menus);
  const related = (topic.relatedIds ?? [])
    .map((id) => getHelpTopicById(allVisible, id))
    .filter((t): t is HelpTopic => !!t);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          All topics
        </Button>
        {deepLink ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigate({ to: deepLink.to });
            }}
          >
            {deepLink.label}
          </Button>
        ) : null}
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            {topic.title}
          </h2>
          <Badge variant="secondary" className="text-[10px] uppercase">
            {topic.kind}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{topic.summary}</p>
      </header>

      <ol className="space-y-3">
        {topic.steps.map((step, index) => (
          <li
            key={`${topic.id}-${index}`}
            className="rounded-lg border bg-card p-4"
          >
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium leading-snug">{step.heading}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {related.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Related
          </h3>
          <div className="space-y-2">
            {related.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenRelated(item.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 py-3 text-left text-sm font-medium hover:bg-muted/40"
              >
                {item.title}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
