// Old /admin links land inside the settings shell; only the sign-in page keeps its own URL.
import { redirect } from "react-router";
import type { Route } from "./+types/admin-redirect";

const MOVED: Record<string, string> = {
  "/admin": "/settings",
  "/admin/settings": "/settings/ops",
  "/admin/content": "/settings/content",
  "/admin/sources": "/settings/sources",
  "/admin/feedback": "/settings/feedback",
  "/admin/runs": "/settings/runs",
  "/admin/models": "/settings/models",
  "/admin/selectbench": "/settings/selectbench",
  "/admin/audit": "/settings/audit",
};

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/admin";
  const exact = MOVED[path] ?? path.replace(/^\/admin/, "/settings");
  return redirect(`${exact}${url.search}`);
}
