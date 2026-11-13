// A strip above every page: the unusual moves the wires reported in the last while.
//
// It is drawn in the browser, so it costs one small request every minute and never blocks a page.
// The reader's own pages keep the link: each headline opens the report it came from.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

interface Mover {
  id: string;
  title: string;
  kind: string;
  label: string;
  sourceName: string;
  at: string;
}

/** The few moves the api answered with, read without trusting the shape. */
function readItems(body: unknown): Mover[] {
  if (!body || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items)) return [];
  const items: Mover[] = [];
  for (const item of body.items) {
    if (!item || typeof item !== "object") continue;
    if (!("id" in item) || typeof item.id !== "string") continue;
    if (!("title" in item) || typeof item.title !== "string") continue;
    if (!("label" in item) || typeof item.label !== "string") continue;
    items.push({
      id: item.id,
      title: item.title,
      kind: "limit",
      label: item.label,
      sourceName: "sourceName" in item && typeof item.sourceName === "string" ? item.sourceName : "",
      at: "at" in item && typeof item.at === "string" ? item.at : "",
    });
  }
  return items;
}

export function MoverAlert() {
  const { pathname } = useLocation();
  const [items, setItems] = useState<Mover[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/site/movers", { headers: { accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (alive) setItems(readItems(body));
        })
        .catch(() => {});
    load();
    // The wires publish every minute; the strip follows them at the same pace.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname]);

  if (items.length === 0) return null;
  // Three at a time: the strip is a notice, not the list. The api answers with all of them.
  const shown = items.slice(0, 3);
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] px-4 pb-3">
      <div className="card px-4 py-2.5 text-[12.5px] leading-[1.7] text-ink-3">
        <span className="font-semibold text-ink">异动</span>
        <span className="mx-1.5 text-line-strong">·</span>
        {shown.map((item, index) => (
          <span key={item.id} className="inline-flex max-w-full items-baseline">
            {index > 0 && <span className="mx-1.5 text-line-strong">|</span>}
            <Link
              viewTransition
              to={`/items/${item.id}`}
              className="inline-flex max-w-full items-baseline transition-colors hover:text-accent"
              title={`${item.label} · ${item.sourceName} · ${item.title}`}
            >
              <span className="shrink-0 text-accent">{item.label}</span>
              <span className="ml-1 truncate">{item.title}</span>
            </Link>
          </span>
        ))}
        {items.length > shown.length && <span className="ml-1.5 text-ink-4">等 {items.length} 条</span>}
      </div>
    </div>
  );
}
