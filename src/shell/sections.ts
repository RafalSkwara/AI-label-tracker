import type { AppRole } from "./useRoles";

/** Main-nav sections in redirect order. An entry is added only in the phase that ships its route. */
export const SECTIONS: { href: string; label: string; role: AppRole }[] = [
  { href: "/", label: "Dashboard", role: "dashboard" },
  { href: "/admin/uzytkownicy", label: "Użytkownicy", role: "admin" },
];
