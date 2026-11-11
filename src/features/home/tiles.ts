import type { IconName } from "@/shell/Icon";
import type { AppRole } from "@/shell/useRoles";

export type Tile = { href: string; icon: IconName; title: string; desc: string; role: AppRole | null };

/** Home-page tiles, one per feature (sub-pages are switched inside the feature). role null: every user with a role. */
export const TILES: Tile[] = [
  { href: "/dashboard", icon: "gauge", title: "Kanały", desc: "YouTube, muzyka, zadania i koszty", role: "dashboard" },
  { href: "/zakupy", icon: "cart", title: "Zakupy", desc: "Twoje i udostępnione listy", role: null },
  { href: "/zapasy", icon: "box", title: "Zapasy", desc: "Domowe zapasy", role: "zapasy" },
];
