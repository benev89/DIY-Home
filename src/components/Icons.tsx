// Simple line icons (SF Symbols–like) for the tab bar and home screen. They use currentColor.
const base = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const HomeIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
    <path d="M10 20v-6h4v6" />
  </svg>
);
export const BoxIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </svg>
);
export const CalendarIcon = () => (
  <svg {...base} aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="m9 15 2 2 4-4" />
  </svg>
);
export const CartIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
    <circle cx="10" cy="20" r="1.3" />
    <circle cx="17" cy="20" r="1.3" />
  </svg>
);
export const WrenchIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M20 7.5a4.5 4.5 0 0 1-6.2 4.2L6.5 19a2.1 2.1 0 0 1-3-3l7.3-7.3A4.5 4.5 0 0 1 16.5 3l-2.8 2.8.7 2.8 2.8.7z" />
  </svg>
);
export const CameraIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const ChevronIcon = () => (
  <svg {...base} width={18} height={18} aria-hidden>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
