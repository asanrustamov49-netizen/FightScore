import type { SVGProps } from "react";

/** Inline stroke icons: no icon library and no network requests (PROJECT_SPEC §6). */
const PATHS = {
  // Bracket / tournament board
  organizer: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h4M7 12h4M7 16h4M15 10h2v4h-2" />
      <path d="M11 8v4M11 12v4" />
    </>
  ),
  // Whistle
  judge: (
    <>
      <circle cx="9" cy="14" r="5" />
      <path d="M13.5 11.5 21 7v4l-6.2 1.6" />
      <circle cx="9" cy="14" r="1.5" />
      <path d="M6 5l1.5 2M11 4v2.5" />
    </>
  ),
  // Television
  display: (
    <>
      <rect x="2.5" y="5" width="19" height="12.5" rx="2" />
      <path d="M8 21h8M12 17.5V21" />
      <path d="M7 10.5h2M15 10.5h2M11 12.5h2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 19h16" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
