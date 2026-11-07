// The editorial strategy switch, drawn on the sources page: how material is selected and how its copy
// is written, plus the rule filter's terms. Strategies come from the engine's registry.
import { useState } from "react";
import { CATEGORY_KEYS, CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import type { AdminSettings } from "@aihot/contracts/admin";
import { useAdminAction } from "./action";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";

/** Splits a comma-, Chinese-comma- or newline-separated list into its terms. */
const listOf = (value: string) => value.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean);

/** The three ways to decide 精选; ids match the engine's registered selection strategies. */
const SELECTION_MODES = [
  { id: "model", label: "模型筛选", hint: "预筛 + 两次评分，需要模型额度" },
  { id: "webai", label: "网页 AI 筛选", hint: "网页免费模型读关键词并打分，慢" },
  { id: "segment", label: "规则筛选", hint: "本地分词词表，配合下面的关键词与来源" },
] as const;

export function EditorialCard({ editorial, strategies }: Pick<AdminSettings, "editorial" | "strategies">) {
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
    webaiEnabled: editorial.webai.enabled ? "true" : "false",
    webaiSites: editorial.webai.sites.join("，"),
    webaiProfile: editorial.webai.profile ?? "",
    webaiTimeout: String(editorial.webai.timeoutSeconds),
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
        webai: {
          enabled: v.webaiEnabled === "true",
          sites: listOf(v.webaiSites),
          profile: v.webaiProfile.trim() || null,
          timeoutSeconds: Number(v.webaiTimeout) || 120,
        },
      },
      { label: "editorial", success: "筛选与写作设置已保存" },
    );
  return (
    <Card
      className="mb-5"
      title="筛选与写作"
      right={<Button tone="primary" busy={pending === "editorial"} onClick={() => void save()}>保存</Button>}
    >
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
        筛选方式三选一：模型筛选要模型额度；网页 AI 筛选走免费网页模型（慢，需要登录）；规则筛选用本地分词词表，不联网。规则字段只在规则筛选下生效，留空表示只按分词评分。保存后对下一篇资料生效。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="筛选方式">
          <div className="grid gap-2 sm:grid-cols-3">
            {SELECTION_MODES.map((mode) => {
              const active = v.selection === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setV({ ...v, selection: mode.id })}
                  className={`rounded-control px-3 py-2 text-left ring-1 transition ${active ? "bg-accent/5 ring-accent" : "ring-line-strong hover:bg-bg-sunk"}`}
                  aria-pressed={active}
                >
                  <span className="block text-[13px] font-medium text-ink">{mode.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{mode.hint}</span>
                </button>
              );
            })}
          </div>
          {!SELECTION_MODES.some((mode) => mode.id === v.selection) ? (
            <p className="mt-2 text-[11px] text-ink-3">当前保存的是「{v.selection}」；点上面任一方式会改为固定方式。</p>
          ) : null}
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
      <div className="mt-5 rounded-panel bg-bg-sunk/50 p-4 ring-1 ring-line">
        <h3 className="text-[13px] font-semibold text-ink">网页 AI 清洗（opencli）</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          开启后，入选的资料会按顺序发给这些网页端免费模型，由它们写中文标题和摘要；只有依次尝试这些站点，失败的那个冷却 10 分钟。模型调用打开时「自动」不走这里。
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="启用">
            <Select value={v.webaiEnabled} onChange={(e) => setV({ ...v, webaiEnabled: e.target.value })}>
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </Select>
          </Field>
          <Field label="站点" hint="opencli 的站点名，逗号分隔">
            <Input value={v.webaiSites} onChange={(e) => setV({ ...v, webaiSites: e.target.value })} placeholder="qwen，yuanbao，kimi" />
          </Field>
          <Field label="浏览器配置" hint="多个 Browser Bridge 同时连接时必填">
            <Input value={v.webaiProfile} onChange={(e) => setV({ ...v, webaiProfile: e.target.value })} placeholder="qpsqtqvw" />
          </Field>
          <Field label="超时（秒）" hint="单条资料的等待上限">
            <Input type="number" min={30} max={600} value={v.webaiTimeout} onChange={(e) => setV({ ...v, webaiTimeout: e.target.value })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}
