// A gauge: the reading the module is about.
export function CrowdingIcon(p: { size?: number }) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 12l3.8-3.4" />
      <path d="M12 3.8v1.8M20.2 12h-1.8M12 20.2v-1.8M3.8 12h1.8" />
    </svg>
  );
}
