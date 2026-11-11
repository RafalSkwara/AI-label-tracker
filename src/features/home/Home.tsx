"use client";

import Link from "next/link";
import Icon from "@/shell/Icon";
import type { AppRole } from "@/shell/useRoles";
import { TILE_GROUPS } from "./tiles";
import s from "./home.module.css";

/** Start page: a tile per feature the user may open, grouped by area */
export default function Home({ can }: { can: (role: AppRole) => boolean }) {
  const groups = TILE_GROUPS
    .map((g) => ({ ...g, tiles: g.tiles.filter((t) => t.role === null || can(t.role)) }))
    .filter((g) => g.tiles.length > 0);
  return (
    <main className={s.page}>
      <h1>Asystent</h1>
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={"g-" + g.title}>
          <h2 id={"g-" + g.title} className={s.group}>{g.title}</h2>
          <div className={s.grid}>
            {g.tiles.map((t) => (
              <Link key={t.href} href={t.href} className={s.tile}>
                <span className={s.icon}><Icon name={t.icon} /></span>
                <span className={s.title}>{t.title}</span>
                <span className={s.desc}>{t.desc}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
