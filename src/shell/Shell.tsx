"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Login from "@/components/Login";
import AppNav from "./AppNav";
import NoAccess from "./NoAccess";
import { type AppRole, useRoles } from "./useRoles";
import { useSession } from "./useSession";

export type ShellCtx = { email: string; userId: string; can: (role: AppRole) => boolean };

/** Owns the session and the user's roles, draws the main nav and renders children only for users holding `need` (null: any role) */
export default function Shell({ need, children }: { need: AppRole | null; children: (ctx: ShellCtx) => ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const { roles, can, ready, error, reload } = useRoles(session?.user.id);

  // A section the user may not open sends them to the home page, which every user with a role can open
  const target = ready && !error && roles.size > 0 && need !== null && !can(need) ? "/" : undefined;
  useEffect(() => { if (target) router.replace(target); }, [target, router]);

  if (session === undefined) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;
  if (!session) return <Login />;
  if (!ready) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;
  if (error) return <NoAccess error={`Nie udało się wczytać uprawnień: ${error}`} onRetry={reload} />;
  if (roles.size === 0) return <NoAccess />;
  if (need !== null && !can(need)) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;

  const email = session.user.email ?? "";
  return (
    <>
      <AppNav can={can} email={email} />
      {children({ email, userId: session.user.id, can })}
    </>
  );
}
