"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Icon from "./Icon";
import { MORE, SECTIONS } from "./sections";
import type { AppRole } from "./useRoles";

/** Bottom tab bar: the sections the user may open, plus "Więcej" (admin, password, privacy, sign out) in a sheet */
export default function AppNav({ can, email }: { can: (role: AppRole) => boolean; email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ok = (r: AppRole | null) => r === null || can(r);
  const moreActive = MORE.some((m) => m.href === path);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <>
      <nav className="tabbar" aria-label="Główne">
        <ul>
          {SECTIONS.filter((s) => ok(s.role)).map((s) => (
            <li key={s.href}>
              <Link href={s.href} aria-current={path === s.href ? "page" : undefined}>
                <Icon name={s.icon} />{s.label}
              </Link>
            </li>
          ))}
          <li>
            <button aria-expanded={open} aria-haspopup="dialog" aria-current={moreActive ? "page" : undefined} onClick={() => setOpen(true)}>
              <Icon name="more" />Więcej
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <div className="scrim" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Więcej" onClick={(e) => e.stopPropagation()}>
            <div className="more">
              <span className="who">Zalogowano: {email}</span>
              {MORE.filter((m) => ok(m.role)).map((m) => (
                <Link key={m.href} href={m.href} onClick={() => setOpen(false)}><Icon name={m.icon} size={20} />{m.label}</Link>
              ))}
              <button onClick={() => supabase().auth.signOut()}><Icon name="logout" size={20} />Wyloguj</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
