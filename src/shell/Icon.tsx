/** Line icons (24×24, stroke = currentColor) used by the tab bar, the "Więcej" sheet and the home tiles */
const PATHS = {
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  gauge: "M4 18a8 8 0 1 1 16 0M12 18l4-6M7.5 13.5l-1-1M12 10V8.5M16.5 13.5l1-1",
  cart: "M3 4h2.5l2.2 11h10.6L20 7H6.3M9 20h.01M17 20h.01",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  alert: "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01",
  check: "M4 12.5 9 17.5 20 6.5",
  film: "M3 5h18v14H3zM7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4",
  chart: "M4 4v16h16M8 15l3.5-4 3 2.5L20 8",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.6-2.6-1.6M12 6.5V8M12 16v1.5",
  repeat: "M4 10a7 7 0 0 1 12.5-4.3L19 8M19 4v4h-4M20 14a7 7 0 0 1-12.5 4.3L5 16M5 20v-4h4",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  users: "M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 20v-1.5a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8",
  key: "M15 9a4 4 0 1 0-3.8 4L3 21v-3h3v-3h3l2.2-2.2M16.5 7.5h.01",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  receipt: "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
