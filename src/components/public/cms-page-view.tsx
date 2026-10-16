import type { CmsBlock, CmsPage } from "@/lib/api/public-cms";
import { PublicFormPanel } from "@/components/public/public-form-panel";
import type { PublicFormDefinition } from "@/lib/api/public-forms";
import { CMS_PROSE_CLASS, sanitizeCmsHtml } from "@/lib/cms/sanitize-html";
import { cn } from "@/lib/utils";

interface Props {
  page: CmsPage;
  formsByKey: Record<string, PublicFormDefinition>;
}

function BlockView({
  block,
  formsByKey,
}: {
  block: CmsBlock;
  formsByKey: Record<string, PublicFormDefinition>;
}) {
  if (block.type === "hero") {
    return (
      <section className="mb-8 space-y-4 rounded-xl border border-[#00a3e0]/20 bg-white px-5 py-8 shadow-sm md:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
          {block.headline}
        </h1>
        {block.sub ? (
          <p className="max-w-2xl text-lg text-slate-600">{block.sub}</p>
        ) : null}
        {block.ctas?.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {block.ctas.map((c, i) => {
              const primary = i === 0;
              const accent = i === 1;
              return (
                <a
                  key={c.href + c.label}
                  href={c.href}
                  className={
                    primary
                      ? "inline-flex rounded-md bg-[#00a3e0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0077a8]"
                      : accent
                        ? "inline-flex rounded-md bg-[#f7c948] px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#efb820]"
                        : "inline-flex rounded-md bg-[#4caf50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d9140]"
                  }
                >
                  {c.label}
                </a>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }
  if (block.type === "richtext") {
    return (
      <div
        className={cn(
          "mb-6 max-w-none text-slate-900 [&_a]:text-[#0077a8]",
          CMS_PROSE_CLASS,
        )}
        dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(block.html) }}
      />
    );
  }
  if (block.type === "cta") {
    return (
      <p className="mb-6">
        <a
          href={block.href}
          className="inline-flex rounded-md border-2 border-[#00a3e0] bg-white px-4 py-2 text-sm font-semibold text-[#0077a8] hover:bg-[#e6f6fc]"
        >
          {block.label}
        </a>
      </p>
    );
  }
  if (block.type === "form") {
    const def = formsByKey[block.formKey];
    if (!def) {
      return (
        <p className="text-sm text-red-700">
          Form “{block.formKey}” is not available.
        </p>
      );
    }
    return (
      <div className="mb-8 rounded-lg border border-[#00a3e0]/25 bg-white p-4 shadow-sm">
        <PublicFormPanel definition={def} channel="public" />
      </div>
    );
  }
  return null;
}

export function CmsPageView({ page, formsByKey }: Props) {
  const hasHero = page.bodyBlocks.some((b) => b.type === "hero");
  return (
    <article className="text-slate-900">
      {!hasHero ? (
        <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900">
          {page.title}
        </h1>
      ) : null}
      {page.bodyBlocks.map((b, i) => (
        <BlockView key={i} block={b} formsByKey={formsByKey} />
      ))}
      {page.slug === "forms" ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {Object.values(formsByKey).map((f) => (
            <li key={f.formKey}>
              <a
                href={`/public/forms/${f.formKey}`}
                className="block rounded-md border border-[#00a3e0]/30 bg-white px-3 py-3 text-sm font-semibold text-slate-900 hover:border-[#00a3e0] hover:bg-[#e6f6fc]"
              >
                {f.title}
                {f.allowAnonymous ? (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Anonymous option available
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
