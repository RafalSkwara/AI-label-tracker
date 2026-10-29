import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (OFL, see ./fonts/LICENSE-*.txt) so the build never fetches Google Fonts.
// One call per subset keeps each @font-face's unicode-range; both calls share one family name,
// which next/font derives from the const name (the --font-* variable points at it).
// next/font needs literal values, hence the repeated ranges (Google's standard latin / latin-ext).

const bricolageExt = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'bricolage'" }, { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  variable: "--font-display-ext",
});
const bricolage = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'bricolage'" }, { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  variable: "--font-display",
});

const plexSansExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'plexSans'" }, { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  variable: "--font-body-ext",
});
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'plexSans'" }, { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  variable: "--font-body",
});

const plexMonoExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'plexMono'" }, { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  variable: "--font-mono-ext",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  declarations: [{ prop: "font-family", value: "'plexMono'" }, { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Side Hustle Assistant",
  description: "Asystent projektów side hustle: alerty, YouTube, zadania, KPI i koszty",
  appleWebApp: { capable: true, title: "Side Hustle", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1412" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} ${bricolageExt.variable} ${plexSansExt.variable} ${plexMonoExt.variable}`}>
      <body>{children}</body>
    </html>
  );
}
