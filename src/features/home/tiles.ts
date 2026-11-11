import type { IconName } from "@/shell/Icon";
import type { AppRole } from "@/shell/useRoles";

export type Tile = { href: string; icon: IconName; title: string; desc: string; role: AppRole | null };
export type TileGroup = { title: string; tiles: Tile[] };

/** Home-page tiles, one per feature. role null: every user with a role. */
export const TILE_GROUPS: TileGroup[] = [
  {
    title: "Kanały",
    tiles: [
      { href: "/dashboard?tab=dzis", icon: "gauge", title: "Przegląd", desc: "Metryki kanałów, wnioski i alerty", role: "dashboard" },
      { href: "/dashboard?tab=zadania", icon: "check", title: "Zadania", desc: "Lista zadań i terminy", role: "dashboard" },
      { href: "/dashboard?tab=pipeline", icon: "film", title: "Pipeline", desc: "Filmy, EP-ki, shorty i automatyzacja", role: "dashboard" },
      { href: "/dashboard?tab=tygodnie", icon: "chart", title: "Tygodnie", desc: "KPI tydzień po tygodniu", role: "dashboard" },
      { href: "/dashboard?tab=koszty", icon: "coin", title: "Koszty", desc: "Wydatki i budżet", role: "dashboard" },
      { href: "/dashboard?tab=subskrypcje", icon: "repeat", title: "Subskrypcje", desc: "Abonamenty i odnowienia", role: "dashboard" },
      { href: "/dashboard?tab=muzyka", icon: "music", title: "Muzyka", desc: "Tantiemy z DistroKid", role: "dashboard" },
    ],
  },
  {
    title: "Dom",
    tiles: [
      { href: "/zakupy", icon: "cart", title: "Zakupy", desc: "Twoje listy zakupów", role: null },
      { href: "/zapasy", icon: "box", title: "Zapasy", desc: "Wspólna lista domowych zapasów", role: "zapasy" },
    ],
  },
];
