"use client";

import Link from "next/link";
import Icon from "@/shell/Icon";
import type { AppRole } from "@/shell/useRoles";
import { TILES } from "./tiles";
import s from "./home.module.css";

/** Start page: one tile per feature the user may open, two columns also on a phone */
export default function Home({ can }: { can: (role: AppRole) => boolean }) {
  const tiles = TILES.filter((t) => t.role === null || can(t.role));
  return (
    <main className={s.page}>
      <h1>Asystent</h1>
      <nav className={s.grid} aria-label="Funkcje">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className={s.tile}>
            <span className={s.icon}><Icon name={t.icon} /></span>
            <span className={s.title}>{t.title}</span>
            <span className={s.desc}>{t.desc}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
