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
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  door: 'M4 21h16M6 21V4h9v17M15 4l4 2v15M11.5 12.5h.01',
  bed: 'M3 6v13M3 16h18v3M21 16v-4a3 3 0 00-3-3h-7v7M7 12.5a1.5 1.5 0 100-.01',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM15.5 13.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  'file-plus': 'M6 2h9l5 5v15H6zM14 2v6h6M12 11v6M9 14h6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  minus: 'M6 12h12',
  'chevron-down': 'M6 9l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  rotate: 'M20 12a8 8 0 11-2.34-5.66M20 4v5h-5',
  square: 'M5 5h14v14H5z',
  brush: 'M14 4l6 6-8.5 8.5a2.5 2.5 0 01-3.5 0l-.5-.5a2.5 2.5 0 010-3.5zM8 16c-1 2-3 3-5 3 1-2 1-4 3-5',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V11M11 10V4.5a1.5 1.5 0 013 0V11M14 10.5V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-.5a6 6 0 01-4.6-2.2L3 15.3a1.6 1.6 0 012.4-2.1L8 15.5',
  'zoom-in': 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M11 8v6M8 11h6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  compass: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM15.5 8.5l-2 5-5 2 2-5z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-5 w-5', label }: { name: IconName; className?: string; label?: string }) {
  const flip = name === 'chevron-back' || name === 'chevron-forward' || name === 'arrow' ? ' rtl:-scale-x-100' : '';
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
