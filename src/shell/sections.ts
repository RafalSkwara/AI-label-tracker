import type { AppRole } from "./useRoles";

/** Main-nav sections. role null: every user with at least one role (personal modules, the home page). */
export const SECTIONS: { href: string; label: string; role: AppRole | null }[] = [
  { href: "/", label: "Start", role: null },
  { href: "/dashboard", label: "Dashboard", role: "dashboard" },
  { href: "/zakupy", label: "Zakupy", role: null },
  { href: "/zapasy", label: "Zapasy", role: "zapasy" },
  { href: "/admin/uzytkownicy", label: "Użytkownicy", role: "admin" },
];
