// A short reminder above every page: the most crowded names of the day, and a way into the full list.
// It is drawn in the browser, so it costs one small request and never blocks a page.
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

interface AlertItem {
  name: string;
  rank: number;
}

/** The few names the api answered with, read without trusting the shape. */
function readItems(body: unknown): AlertItem[] {
  if (!body || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items)) return [];
  const items: AlertItem[] = [];
  for (const item of body.items) {
    if (!item || typeof item !== "object") continue;
    if (!("name" in item) || typeof item.name !== "string") continue;
    if (!("rank" in item) || typeof item.rank !== "number") continue;
    items.push({ name: item.name, rank: item.rank });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

export function Reminder() {
  const { pathname } = useLocation();
  const [items, setItems] = useState<AlertItem[]>([]);
  useEffect(() => {
    if (pathname === "/crowding") return;
    const controller = new AbortController();
    fetch("/api/site/crowding?top=5", { headers: { accept: "application/json" }, signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setItems(readItems(body)))
      .catch(() => {});
    return () => controller.abort();
  }, [pathname]);

  if (items.length === 0) return null;
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] px-4 pb-10">
      <div className="card px-4 py-3 text-[12.5px] leading-[1.7] text-ink-3">
        <span className="font-semibold text-ink">今日高拥挤</span>
        <span className="mx-1.5 text-line-strong">·</span>
        {items.map((item) => item.name).join("、")}
        <a href="/crowding" className="ml-2 underline decoration-line-strong underline-offset-2">
          看完整名单
        </a>
      </div>
    </div>
  );
}
