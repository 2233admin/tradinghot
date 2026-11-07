// Settings inside the public site: the same admin API behind it, no separate backend shell.
// Signed-out visitors get the password form; the session cookie then unlocks the card.
import { SITE } from "@aihot/site";
import type { AdminSettings } from "@aihot/contracts/admin";
import { ADMIN } from "@aihot/site";
import { data, Link, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { adminGet, adminSignedIn } from "../lib/admin.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { EditorialCard } from "../features/admin/editorial";
import { buttonClass } from "../components/ui/Controls";

export const handle: Screen = { tab: "me", name: "设置" };

const ERRORS: Record<string, string> = {
  wrong: "密码不对，再试一次。",
  unset: "还没有设置管理员密码：在 .env 里设置 ADMIN_PASSWORD（至少 12 位），重启后再登录。",
  "too-many": "尝试次数太多，请 15 分钟后再试。",
};

export async function loader({ request }: Route.LoaderArgs) {
  if (!ADMIN) throw data({ message: "not_found" }, { status: 404 });
  if (!(await adminSignedIn(request).catch(() => false))) {
    const url = new URL(request.url);
    return { signedIn: false as const, error: url.searchParams.get("error") };
  }
  const settings = await adminGet<AdminSettings>(request, "/api/admin/settings");
  return { signedIn: true as const, editorial: settings.editorial, strategies: settings.strategies };
}

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export function meta() {
  return pageMeta({ title: "设置", description: `调整 ${SITE.name} 的筛选与写作方式。`, path: "/settings", noindex: true });
}

export default function SettingsPage() {
  const loaded = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14">
      <PhoneBar title="设置" large />
      <h1 className="hidden pb-4 pt-1 text-[22px] font-bold text-ink lg:block">设置</h1>
      {!loaded.signedIn ? (
        <form method="post" action="/api/auth/password" className="card max-w-[380px] p-6">
          <input type="hidden" name="return" value="/settings" />
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-2">
            管理员密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="mt-2 h-10 w-full rounded-full border border-line-strong bg-surface px-4 text-[14px] text-ink outline-none transition-colors focus:border-accent"
          />
          {sp.get("error") ? (
            <p role="alert" className="mt-3 text-[12.5px] leading-relaxed text-hot">
              {ERRORS[sp.get("error") ?? ""] ?? ERRORS.wrong}
            </p>
          ) : null}
          <button type="submit" className={`${buttonClass("primary", "lg")} mt-5 w-full`}>
            登录
          </button>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-4">
            设置和信源维护共用同一个管理员登录。登录后可以直接在这里改筛选与写作方式。
          </p>
        </form>
      ) : (
        <>
          <p className="pb-4 text-[13.5px] leading-[1.7] text-ink-3">
            选择怎么筛出精选、怎么写作；保存后对下一篇资料生效。
            <Link to="/admin/sources" className="ml-2 text-accent hover:underline">
              信源维护
            </Link>
          </p>
          <EditorialCard editorial={loaded.editorial} strategies={loaded.strategies} />
        </>
      )}
    </div>
  );
}
