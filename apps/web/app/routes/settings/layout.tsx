// Settings inside the public site: one shell for the editorial choice and the operational pages,
// so there is no separate admin product area.
import { ADMIN, SITE } from "@aihot/site";
import { data, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { PhoneBar } from "../../components/shell/PhoneBar";
import type { Screen } from "../../components/shell/screens";

export const handle: Screen = { tab: "me", name: "设置" };

const TABS = [
  { to: "/settings", label: "筛选与写作", end: true },
  { to: "/settings/sources", label: "信源" },
  { to: "/settings/content", label: "内容诊断" },
  { to: "/settings/runs", label: "运行" },
  { to: "/settings/feedback", label: "反馈" },
  { to: "/settings/models", label: "模型与评测" },
  { to: "/settings/selectbench", label: "SelectBench" },
  { to: "/settings/ops", label: "站点设置" },
  { to: "/settings/audit", label: "审计" },
] as const;

export async function loader() {
  if (!ADMIN) throw data({ message: "not_found" }, { status: 404 });
  return null;
}

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export function meta() {
  return [{ title: `设置 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];
}

export default function SettingsLayout() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-20 pt-5 sm:px-6 lg:px-8 lg:pt-8">
      <PhoneBar title="设置" large />
      <h1 className="hidden pb-4 text-[22px] font-bold text-ink lg:block">设置</h1>
      <nav aria-label="设置分区" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={"end" in tab ? tab.end : false}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition ${
                isActive ? "bg-ink text-bg" : "text-ink-3 ring-1 ring-line hover:text-ink"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
