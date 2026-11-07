import { type RouteConfig, type RouteConfigEntry, index, layout, route } from "@react-router/dev/routes";
import type { ModulePage } from "@aihot/contracts/modules";
import { MODULES } from "@aihot/site/modules";

/** A module's route module, from the app directory. */
const file = (module: string, path: string) => `../../../modules/${module}/${path}`;
const page = (module: string, p: ModulePage) => route(p.gray ? `preview/${p.path}` : p.path, file(module, p.file), p.id ? { id: p.id } : {});

/** The site's modules' pages, after the engine's. */
const modulePages: RouteConfigEntry[] = MODULES.flatMap((m) =>
  (m.pages ?? []).map((p) => ("layout" in p ? layout(file(m.name, p.layout), p.id ? { id: p.id } : {}, p.pages.map((c) => page(m.name, c))) : page(m.name, p))),
);

export default [
  index("routes/home.tsx"),
  route("all", "routes/all.tsx"),
  route("all/search-busy", "routes/search-busy.tsx", { id: "all-search-busy" }),
  route("search-busy", "routes/search-busy.tsx", { id: "search-busy" }),
  route("items/:id", "routes/item.tsx"),
  route("items/:id/original", "routes/item-original.tsx", { id: "item-original" }),
  route("hot", "routes/hot.tsx"),
  route("story/:publicId", "routes/story.tsx"),
  route("daily", "routes/report-latest.tsx", { id: "daily-latest" }),
  route("daily/archive", "routes/daily-archive.tsx"),
  route("daily/:key", "routes/report-detail.tsx", { id: "daily-detail" }),
  route("weekly", "routes/report-latest.tsx", { id: "weekly-latest" }),
  route("weekly/:key", "routes/report-detail.tsx", { id: "weekly-detail" }),
  route("monthly", "routes/report-latest.tsx", { id: "monthly-latest" }),
  route("monthly/:key", "routes/report-detail.tsx", { id: "monthly-detail" }),
  route("topics", "routes/topics.tsx"),
  route("topics/:slug", "routes/topic.tsx", { id: "topic" }),
  route("topics/:slug/page/:page", "routes/topic.tsx", { id: "topic-page" }),
  route("about", "routes/about.tsx"),
  route("sources", "routes/sources.tsx"),
  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("changelog", "routes/changelog.tsx"),
  route("feedback", "routes/feedback.tsx"),
  route("more", "routes/more.tsx"),
  route("starred", "routes/starred.tsx"),
  route("agent", "routes/agent.tsx"),
  ...modulePages,
  route("admin/login", "routes/admin-login.tsx"),
  route("admin/*", "routes/admin-redirect.tsx", { id: "admin-redirect" }),
  // One settings shell in the public site; the operational pages are the same modules under /settings.
  layout("routes/settings/layout.tsx", { id: "settings-layout" }, [
    route("settings", "routes/settings/index.tsx", { id: "settings-index" }),
    route("settings/sources", "routes/admin/sources.tsx", { id: "settings-sources" }),
    route("settings/sources/new", "routes/admin/source-new.tsx", { id: "settings-source-new" }),
    route("settings/sources/:id", "routes/admin/source.tsx", { id: "settings-source" }),
    route("settings/content", "routes/admin/content.tsx", { id: "settings-content" }),
    route("settings/content/:id", "routes/admin/content-item.tsx", { id: "settings-content-item" }),
    route("settings/feedback", "routes/admin/feedback.tsx", { id: "settings-feedback" }),
    route("settings/runs", "routes/admin/runs.tsx", { id: "settings-runs" }),
    route("settings/models", "routes/admin/models.tsx", { id: "settings-models" }),
    route("settings/selectbench", "routes/admin/selectbench.tsx", { id: "settings-selectbench" }),
    route("settings/selectbench/:runId", "routes/admin/selectbench-run.tsx", { id: "settings-selectbench-run" }),
    route("settings/ops", "routes/admin/settings.tsx", { id: "settings-ops" }),
    route("settings/audit", "routes/admin/audit.tsx", { id: "settings-audit" }),
  ]),
] satisfies RouteConfig;
