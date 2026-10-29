"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SECTIONS } from "./sections";
import type { AppRole } from "./useRoles";

/** Main nav: only the sections the user may open, plus account links */
export default function AppNav({ can, email }: { can: (role: AppRole) => boolean; email: string }) {
  const path = usePathname();
  return (
    <nav className="appnav" aria-label="Główne">
      <div className="sections">
        {SECTIONS.filter((s) => can(s.role)).map((s) => (
          <Link key={s.href} href={s.href} aria-current={path === s.href ? "page" : undefined}>{s.label}</Link>
        ))}
      </div>
      <div className="account">
        <button className="linkbtn" onClick={() => supabase().auth.signOut()} title={email}>Wyloguj</button>
      </div>
    </nav>
  );
}
