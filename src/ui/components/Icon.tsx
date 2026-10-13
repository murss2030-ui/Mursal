/** Simple stroke icons drawn for PRECEPTOR (24×24 grid). Decorative unless given a label. */
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v11h5v-6h4v6h5V10',
  folder: 'M3 6h6l2 2h10v11H3z',
  'file-text': 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
  book: 'M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3zM21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  'chevron-back': 'M15 18l-6-6 6-6',
  'chevron-forward': 'M9 6l6 6-6 6',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  wifi: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01',
  'wifi-off': 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M3 3l18 18',
  'alert-triangle': 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  'check-circle': 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM8 12l3 3 5-6',
  function: 'M16 4c-2 0-3 1-3.5 3L10 18c-.5 2-1.5 3-3.5 3M8 11h8',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  scale: 'M12 4v16M8 20h8M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  target: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM16 12a4 4 0 11-8 0 4 4 0 018 0zM12 12h.01',
  clock: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 7v5l3 2',
  x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  'eye-off': 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0zM3 3l18 18',
  history: 'M3 12a9 9 0 103-6.7M3 4v5h5M12 7v5l3 2',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
  user: 'M16 8a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  info: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 11v6M12 7.5h.01',
  pill: 'M4.5 12.5l8-8a5 5 0 017 7l-8 8a5 5 0 01-7-7zM8.5 8.5l7 7',
  flask: 'M9 3h6M10 3v6L4 20h16L14 9V3M7 15h10',
  heart: 'M12 20s-7-4.5-9-9a5 5 0 019-3 5 5 0 019 3c-2 4.5-9 9-9 9z',
  microscope: 'M6 21h12M12 21a6 6 0 006-6M9 3l4 2-3 6-4-2zM10 11l-1.5 3',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  note: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  weight: 'M5 21h14l-2-12H7zM9 9a3 3 0 016 0',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  workflow: 'M4 4h6v6H4zM14 14h6v6h-6zM7 10v4a3 3 0 003 3h4',
  graduation: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-5 w-5', label }: { name: IconName; className?: string; label?: string }) {
  const flip = name === 'chevron-back' || name === 'chevron-forward' ? ' rtl:-scale-x-100' : '';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0${flip}`}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
