// The navigation's own marks, in the Arknights language: straight strokes, square caps, mitred
// joins, cut corners, no arcs and no rounded shapes. The engine's icon set stays for the places that
// are not navigation (forms, cards, buttons).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Mark({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 精选 — a bolt cut from two straight strokes. */
export const MarkFeatured = (p: P) => (
  <Mark {...p}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 9.5-11H13z" />
  </Mark>
);

/** 全部动态 — three rows, square bullets. */
export const MarkAll = (p: P) => (
  <Mark {...p}>
    <path d="M4 5.5h2v2H4zM4 11h2v2H4zM4 16.5h2v2H4zM9 5.5h11M9 11h11M9 16.5h11" />
  </Mark>
);

/** 热点榜 — three bars that rise. */
export const MarkHot = (p: P) => (
  <Mark {...p}>
    <path d="M4 19.5h4v-5H4zM10 19.5h4V9h-4zM16 19.5h4V4h-4z" />
  </Mark>
);

/** 日报 — a page with a cut corner. */
export const MarkDaily = (p: P) => (
  <Mark {...p}>
    <path d="M6 2.5h8l4 4v15H6zM14 2.5v4h4M9 11h6M9 14.5h6M9 18h4" />
  </Mark>
);

/** 主题 — four diamonds. */
export const MarkTopics = (p: P) => (
  <Mark {...p}>
    <path d="M7 4.5 9.5 7 7 9.5 4.5 7zM17 4.5 19.5 7 17 9.5 14.5 7zM7 14.5 9.5 17 7 19.5 4.5 17zM17 14.5 19.5 17 17 19.5 14.5 17z" />
  </Mark>
);

/** 收藏 — a bookmark with a sharp point. */
export const MarkStar = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return (
    <Mark {...rest}>
      <path d="M6 2.5h12v19l-6-4.5-6 4.5z" fill={filled ? "currentColor" : "none"} />
    </Mark>
  );
};

/** Agent 接入 — a port. */
export const MarkAgent = (p: P) => (
  <Mark {...p}>
    <path d="M9 2.5h6v4H9zM12 6.5v5M8 11.5h8v3.5H8zM9.5 15v6h5v-6" />
  </Mark>
);

/** 数据源 — a chevron stack. */
export const MarkSources = (p: P) => (
  <Mark {...p}>
    <path d="M4 8.5 12 4l8 4.5-8 4.5zM4 13.5 12 9l8 4.5-8 4.5z" />
  </Mark>
);

/** 设置 — a nut with a square hole. */
export const MarkSettings = (p: P) => (
  <Mark {...p}>
    <path d="M12 2.5 20 7.5v9l-8 5-8-5v-9zM9.5 9.5h5v5h-5z" />
  </Mark>
);

/** 关于 — a cut-corner plate with a slot. */
export const MarkAbout = (p: P) => (
  <Mark {...p}>
    <path d="M4.5 4.5h15v15h-15zM12 9.5v4M12 16.5v.5" />
  </Mark>
);

/** 更新日志 — a square clock. */
export const MarkLog = (p: P) => (
  <Mark {...p}>
    <path d="M4.5 6.5h15v11h-15zM12 9.5V12l2.5 1.5" />
  </Mark>
);

/** 反馈 — a cut-corner bubble. */
export const MarkFeedback = (p: P) => (
  <Mark {...p}>
    <path d="M4 4.5h16v11h-9.5L6 19.5v-4H4z" />
  </Mark>
);

/** 我的 — a square head over a cut shoulder plate. */
export const MarkUser = (p: P) => (
  <Mark {...p}>
    <path d="M9 4.5h6v6H9zM4.5 21v-3l3-2.5h9l3 2.5v3z" />
  </Mark>
);

/** The site's emblem: an angular chevron with a cut, the reference's mark language. */
export const MarkEmblem = (p: P) => (
  <Mark {...p} strokeWidth={2}>
    <path d="M2.5 20.5 12 4.5l9.5 16h-4.8L12 10.5 6.8 20.5z" />
  </Mark>
);
