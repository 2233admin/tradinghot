import { ADMIN, SITE } from "@aihot/site";
import { useRef, useState } from "react";
import type { Route } from "./+types/settings";
import type { AdminSettings } from "@aihot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Field, Input, ReasonDialog, Select, Textarea } from "../../features/admin/ui";
import { CATEGORY_KEYS, CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { toast } from "../../features/admin/toast";


export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminSettings>(request, "/api/admin/settings");
}

export const meta: Route.MetaFunction = () => [{ title: `设置 · ${SITE.name} 后台` }];

function QrSlot({ slot, label, src }: { slot: "wechatQr" | "feishuQr"; label: string; src: string | null }) {
  const { run, pending } = useAdminAction();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      {src ? <img src={src} alt={label} className="size-28 rounded-card bg-white object-contain p-1.5 ring-1 ring-line" /> : <div className="flex size-28 shrink-0 items-center justify-center rounded-card bg-surface text-sm text-ink-4 ring-1 ring-line">未设置</div>}
      <div>
        <div className="text-[14px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink-4">{src}</div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) return toast("图片最大 2MB", "error");
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await run("POST", "/api/admin/settings/contact-qr", { slot, image }, { label: `qr-${slot}`, success: `${label}已更换，关于页 5 分钟内更新` });
          }}
        />
        <Button className="mt-2" size="sm" busy={pending === `qr-${slot}`} onClick={() => input.current?.click()}>更换图片</Button>
      </div>
    </div>
  );
}

function BudgetRow({ b }: { b: AdminSettings["budgets"][number] }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ perMinute: b.per_minute, perHour: b.per_hour, perDay: b.per_day });
  const [open, setOpen] = useState(false);
  const changed = v.perMinute !== b.per_minute || v.perHour !== b.per_hour || v.perDay !== b.per_day;
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="px-3 py-2 font-mono text-[12.5px]">{b.service}</td>
      {(["perMinute", "perHour", "perDay"] as const).map((k) => (
        <td key={k} className="px-3 py-2">
          <Input type="number" min={0} className="!w-24 !py-1 text-right" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        </td>
      ))}
      <td className="num px-3 py-2 text-right text-ink-3">{num(b.used_hour)} / {num(b.used_day)}</td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" tone="primary" disabled={!changed} onClick={() => setOpen(true)}>保存</Button>
        <ReasonDialog
          open={open}
          title={`调整 ${b.service} 的请求上限`}
          description={`上限是付费请求的熔断：超过后请求暂停并按窗口重试。填 0 表示立即停用这个服务。${ADMIN?.budgetNote ?? ""}`}
          confirmLabel="保存"
          busy={pending === "budget"}
          onClose={() => setOpen(false)}
          onSubmit={async (reason) => (await run("PUT", `/api/admin/budgets/${encodeURIComponent(b.service)}`, { ...v, reason }, { label: "budget", success: "上限已更新" })) !== null}
        />
      </td>
    </tr>
  );
}

function TargetToggle({ t }: { t: AdminSettings["targets"][number] }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" tone={t.enabled ? "danger" : "primary"} onClick={() => setOpen(true)}>{t.enabled ? "停用" : "启用"}</Button>
      <ReasonDialog
        open={open}
        title={`${t.enabled ? "停用" : "启用"}：${t.note ?? t.key}`}
        description={t.enabled ? "停用后新的推送不再发往这个群。" : "启用时间会被记录：启用之前的内容不会补推。开发与彩排环境即使启用也不会真的发出。"}
        danger={t.enabled}
        confirmLabel={t.enabled ? "停用" : "启用"}
        busy={pending === "target"}
        onClose={() => setOpen(false)}
        onSubmit={async (reason) => (await run("POST", `/api/admin/notify-targets/${encodeURIComponent(t.key)}`, { enabled: !t.enabled, reason }, { label: "target", success: "已更新" })) !== null}
      />
    </>
  );
}

/** Splits a comma-, Chinese-comma- or newline-separated list into its terms. */
const listOf = (value: string) => value.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean);

function EditorialCard({ editorial, strategies }: Pick<AdminSettings, "editorial" | "strategies">) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({
    selection: editorial.selection,
    writing: editorial.writing,
    keywords: editorial.rules.keywords.join("，"),
    excludeKeywords: editorial.rules.excludeKeywords.join("，"),
    sources: editorial.rules.sources.join("，"),
    excludeSources: editorial.rules.excludeSources.join("，"),
    symbols: editorial.rules.symbols.join("，"),
    lookbackHours: editorial.rules.lookbackHours === null ? "" : String(editorial.rules.lookbackHours),
    category: editorial.rules.category ?? "",
    tags: editorial.rules.tags.join("，"),
  });
  const save = () =>
    run(
      "PUT",
      "/api/admin/settings/editorial",
      {
        selection: v.selection,
        writing: v.writing,
        rules: {
          keywords: listOf(v.keywords),
          excludeKeywords: listOf(v.excludeKeywords),
          sources: listOf(v.sources),
          excludeSources: listOf(v.excludeSources),
          symbols: listOf(v.symbols),
          lookbackHours: v.lookbackHours.trim() ? Number(v.lookbackHours) : null,
          category: v.category || null,
          tags: listOf(v.tags),
        },
      },
      { label: "editorial", success: "筛选与写作设置已保存" },
    );
  return (
    <Card
      className="mt-5"
      title="筛选与写作"
      right={<Button tone="primary" busy={pending === "editorial"} onClick={() => void save()}>保存</Button>}
    >
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
        选中「规则筛选」或「原文写作」时不调用模型；规则写在库里，保存后对下一篇资料生效。筛选方式和写作方式都可以换成模块注册的新策略。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="筛选方式" hint="模型评分：预筛 + 两次打分；规则筛选：关键词 / 来源 / 标的 / 时间窗">
          <Select value={v.selection} onChange={(e) => setV({ ...v, selection: e.target.value })}>
            {strategies.selection.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="写作方式" hint="原文写作：用原标题和正文开头，不调用模型">
          <Select value={v.writing} onChange={(e) => setV({ ...v, writing: e.target.value })}>
            {strategies.writing.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="关键词" hint="命中任意一个；逗号或换行分隔">
          <Textarea value={v.keywords} onChange={(e) => setV({ ...v, keywords: e.target.value })} placeholder="美联储，降息，财报" />
        </Field>
        <Field label="排除关键词" hint="命中任意一个就不入选">
          <Textarea value={v.excludeKeywords} onChange={(e) => setV({ ...v, excludeKeywords: e.target.value })} placeholder="广告，招聘" />
        </Field>
        <Field label="标的" hint="命中任意一个；和关键词同时填写时都要命中">
          <Textarea value={v.symbols} onChange={(e) => setV({ ...v, symbols: e.target.value })} placeholder="BTC，NVDA，贵州茅台" />
        </Field>
        <Field label="允许的信源" hint="留空表示不限；填信源 ID">
          <Textarea value={v.sources} onChange={(e) => setV({ ...v, sources: e.target.value })} placeholder="cn-jin10-flash，cn-tgb-index" />
        </Field>
        <Field label="排除的信源" hint="留空表示不排除；填信源 ID">
          <Textarea value={v.excludeSources} onChange={(e) => setV({ ...v, excludeSources: e.target.value })} placeholder="example-source" />
        </Field>
        <Field label="回溯小时" hint="只匹配这个时间内发布的资料；留空不限">
          <Input type="number" min={1} max={720} value={v.lookbackHours} onChange={(e) => setV({ ...v, lookbackHours: e.target.value })} placeholder="24" />
        </Field>
        <Field label="分类" hint="规则选中的资料归到这一类；留空则不进分类页">
          <Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
            <option value="">不分类</option>
            {CATEGORY_KEYS.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
          </Select>
        </Field>
        <Field label="标签" hint="规则选中的资料带上这些标签；逗号分隔">
          <Input value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="量化，A股" />
        </Field>
      </div>
    </Card>
  );
}

export default function SettingsAdmin({ loaderData: s }: Route.ComponentProps) {
  return (
    <AdminPage title="设置" subtitle="不改代码即可替换的运营设置。每次修改都写入审计记录。">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="关于页二维码">
          <div className="space-y-5">
            <QrSlot slot="wechatQr" label="微信公众号二维码" src={s.contact.wechatQr} />
            <QrSlot slot="feishuQr" label="飞书群二维码" src={s.contact.feishuQr} />
          </div>
        </Card>
        <Card title="通知目的地" pad={false}>
          <DataTable
            rows={s.targets}
            rowKey={(t) => t.key}
            columns={[
              { key: "k", label: "目的地", render: (t) => <div><div className="font-medium text-ink">{t.note ?? t.key}</div><div className="font-mono text-[11.5px] text-ink-4">{t.key} · {t.config_ref}</div></div> },
              { key: "e", label: "状态", render: (t) => (t.enabled ? <Badge tone="ok">启用于 {bj(t.enabled_at)}</Badge> : <Badge>停用</Badge>) },
              { key: "d", label: "7 天投递", align: "right", render: (t) => num(t.deliveries_7d) },
              { key: "a", label: "", align: "right", render: (t) => <TargetToggle t={t} /> },
            ]}
          />
        </Card>
      </div>
      <EditorialCard editorial={s.editorial} strategies={s.strategies} />
      <Card className="mt-5" title="付费请求上限" right={<span>已用：近 1 小时 / 近 24 小时</span>} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="px-3 py-2 font-medium">服务</th>
                <th className="px-3 py-2 font-medium">每分钟</th>
                <th className="px-3 py-2 font-medium">每小时</th>
                <th className="px-3 py-2 font-medium">每天</th>
                <th className="px-3 py-2 text-right font-medium">已用</th>
                <th />
              </tr>
            </thead>
            <tbody>{s.budgets.map((b) => <BudgetRow key={`${b.service}-${b.updated_at}`} b={b} />)}</tbody>
          </table>
        </div>
      </Card>
    </AdminPage>
  );
}
