---
schema: design-pipeline.motion-foundation.v0.1
name: 股市热点热榜静态交互
posture: static
primitiveRegistry: design-pipeline.motion-primitives.v1
---

## Motion Thesis

页面以读数稳定为先；内容更新与筛选结果直接呈现，不使用装饰性动画。

## Motion Principles

交互状态以文本、边框和颜色变化反馈；排序和位置变化不通过移动动画暗示实时性。

## Motion Vocabulary

不选用移动类 primitive；点击、加载和错误状态由静态语义控件呈现。

## Procedural Motion

不使用程序化动效、随机性或持续运行的动画。

## Runtime Policy

使用项目现有 React 和 CSS；不引入额外动画库。

## Reduced Motion

替代方案：禁用所有过渡，直接显示状态文本与边框；所有状态无需依赖运动即可理解。

## Source Decisions

采用：项目的静态阅读优先原则。
拒绝：复制或推测 NewsNow 上游动画实现；参考截图不能证明动效参数。
