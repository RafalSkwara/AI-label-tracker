import type { AppRole } from "@/shell/useRoles";

export type Tile = { href: string; icon: string; title: string; desc: string; role: AppRole | null };
export type TileGroup = { title: string; tiles: Tile[] };

/** Home-page tiles, one per feature. role null: every user with a role. */
export const TILE_GROUPS: TileGroup[] = [
  {
    title: "Side hustle",
    tiles: [
      { href: "/dashboard?tab=dzis", icon: "☀️", title: "Dziś", desc: "Alerty, bramki i postęp", role: "dashboard" },
      { href: "/dashboard?tab=zadania", icon: "✅", title: "Zadania", desc: "Lista zadań i terminy", role: "dashboard" },
      { href: "/dashboard?tab=pipeline", icon: "🎬", title: "Pipeline", desc: "Filmy, EP-ki, shorty i automatyzacja", role: "dashboard" },
      { href: "/dashboard?tab=tygodnie", icon: "📈", title: "Tygodnie", desc: "KPI tydzień po tygodniu", role: "dashboard" },
      { href: "/dashboard?tab=koszty", icon: "💸", title: "Koszty", desc: "Wydatki i budżet", role: "dashboard" },
      { href: "/dashboard?tab=subskrypcje", icon: "🔁", title: "Subskrypcje", desc: "Abonamenty i odnowienia", role: "dashboard" },
      { href: "/dashboard?tab=muzyka", icon: "🎵", title: "Muzyka", desc: "Tantiemy z DistroKid", role: "dashboard" },
    ],
  },
  {
    title: "Dom",
    tiles: [
      { href: "/zakupy", icon: "🛒", title: "Zakupy", desc: "Twoje listy zakupów", role: null },
      { href: "/zapasy", icon: "📦", title: "Zapasy", desc: "Wspólna lista domowych zapasów", role: "zapasy" },
    ],
  },
  {
    title: "Konto",
    tiles: [
      { href: "/admin/uzytkownicy", icon: "👥", title: "Użytkownicy", desc: "Zaproszenia i role", role: "admin" },
      { href: "/haslo", icon: "🔑", title: "Hasło", desc: "Zmień hasło", role: null },
    ],
  },
];
