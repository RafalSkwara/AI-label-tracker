import type { IconName } from "./Icon";
import type { AppRole } from "./useRoles";

/** Bottom tab bar, left to right. role null: every user with at least one role (personal modules, the home page). */
export const SECTIONS: { href: string; label: string; icon: IconName; role: AppRole | null }[] = [
  { href: "/", label: "Start", icon: "home", role: null },
  { href: "/dashboard", label: "Kanały", icon: "gauge", role: "dashboard" },
  { href: "/zakupy", label: "Zakupy", icon: "cart", role: null },
  { href: "/zapasy", label: "Zapasy", icon: "box", role: "zapasy" },
];

/** Links in the "Więcej" sheet behind the last tab */
export const MORE: { href: string; label: string; icon: IconName; role: AppRole | null }[] = [
  { href: "/admin/uzytkownicy", label: "Użytkownicy", icon: "users", role: "admin" },
  { href: "/haslo", label: "Zmień hasło", icon: "key", role: null },
  { href: "/privacy", label: "Prywatność", icon: "doc", role: null },
];
