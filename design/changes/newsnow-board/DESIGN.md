---
name: 股市热点 · 多来源热榜
tokens:
  ground: "#0f1116"
  panel: "#15181e"
  surface: "#191d24"
  surfaceRaised: "#1e232b"
  accent: "#a3c4d5"
  text: "#eef2f5"
  muted: "#9aa6b0"
  faint: "#69737e"
  border: "rgba(255,255,255,0.075)"
  borderStrong: "rgba(255,255,255,0.14)"
  accentDim: "rgba(163,196,213,0.20)"
  accentWash: "rgba(163,196,213,0.10)"
---

## Product Context

股市热点的多来源热榜供读者并排检查来源，区分实时资讯和热门排名。真实发布时间和抓取状态优先，未知时间不填造。

## Overview

延续项目根目录 `DESIGN.md` 的明日方舟式冷蓝终端：近黑底、方角、细线和紧凑中文排版。参照 NewsNow 的多列来源卡片，但不复制其品牌、颜色或圆角。

## Colors

地面 `ground`、卡片 `surface`、文字 `text` 与 `muted` 继承站点；`accent` 标示当前选择和键盘焦点。其他来源品牌色不作大面积装饰。

## Typography

中文正文使用现有站点字体；列表正文 14–15px，来源标题 16px，更新状态 12px。序号和时间使用现有数字字形。

## Layout & Spacing

保留本站导航和手机底栏；宽屏在剩余空间内排列来源卡片，窄屏自然变单列。卡片标题内含来源名、状态与操作，正文为可阅读的有序标题列表；使用 8px 间隔、1px 分隔线，内容不被裁切。

## Components

来源卡片有加载、成功、缓存、空数据及失败状态；搜索与分类选择控制实际展示；收藏可切换并持久保存。按钮提供可见名称和焦点，不以颜色独自表达状态。

## Do's and Don'ts

显示信源类型和已知发布时间；允许用户选择来源并打开原文。不要声称无日期榜单是按发布时间排序；不要展示未经证实的刷新时刻；不要加入阴影或圆角。

## Source Decisions

Adopted: NewsNow 的多来源并列、来源搜索、热榜和实时分类、单源刷新和关注；布局节奏和字号参照 `reference/extract/extraction.json`。颜色采用项目根目录 `DESIGN.md`，动效为静态。
Rejected: 上游 content、copy、brand marks、logos、彩色背景及圆角；页面引用真实数据而非复制截图里的新闻。
