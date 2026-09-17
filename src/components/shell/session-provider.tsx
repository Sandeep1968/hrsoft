"use client";

import { createContext, useContext } from "react";
import type { Permission, Scope } from "@/lib/rbac/permissions";

export interface ClientSession {
  userId: string;
  email: string;
  name: string;
  image?: string | null;
  employeeId: string | null;
  employeeCode?: string | null;
  roles: string[];
  permissions: Record<string, Scope>;
  hasReports: boolean;
}

const Ctx = createContext<ClientSession | null>(null);

export function SessionProvider({ session, children }: { session: ClientSession; children: React.ReactNode }) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession(): ClientSession {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

const RANK: Record<Scope, number> = { SELF: 1, TEAM: 2, ALL: 3 };

/** Client-side permission check (UI gating only — the server always re-checks). */
export function useCan() {
  const s = useSession();
  return (permission: Permission, minScope: Scope = "SELF") => {
    const scope = s.permissions[permission];
    return Boolean(scope) && RANK[scope] >= RANK[minScope];
  };
}
