"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "dashboard" | "zapasy";

export type Roles = {
  roles: Set<AppRole>;
  /** admin passes every check, as in the database (has_role) */
  can: (role: AppRole) => boolean;
  ready: boolean;
  error: string;
  reload: () => void;
};

/** Roles of the signed-in user, loaded on start and whenever the user changes */
export function useRoles(userId: string | undefined): Roles {
  const [state, setState] = useState<{ userId?: string; roles: Set<AppRole>; error: string }>({ roles: new Set(), error: "" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase().from("user_roles").select("role").eq("user_id", userId).then(({ data, error }) => {
      if (!live) return;
      setState({ userId, roles: new Set((data ?? []).map((r) => r.role as AppRole)), error: error?.message ?? "" });
    });
    return () => { live = false; };
  }, [userId, nonce]);

  const ready = !!userId && state.userId === userId;
  const can = useCallback((role: AppRole) => state.roles.has(role) || state.roles.has("admin"), [state.roles]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { roles: state.roles, can, ready, error: ready ? state.error : "", reload };
}
