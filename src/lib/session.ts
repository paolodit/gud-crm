import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export type CurrentMember = {
  id: string;
  name: string;
  email: string;
  organisationId: string;
  role: "admin" | "manager" | "member";
  demoMode: boolean;
  storageMode: "demo" | "sqlite" | "postgres";
};

const demoMember: CurrentMember = {
  id: "demo-admin",
  name: "Alex Morgan",
  email: "alex@example.com",
  organisationId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  demoMode: true,
  storageMode: "demo",
};

const localMember: CurrentMember = {
  ...demoMember,
  demoMode: false,
  storageMode: "sqlite",
};

export async function getCurrentMember(): Promise<CurrentMember | null> {
  if (env.demoMode) return demoMember;
  if (env.sqliteMode) return localMember;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = session.user as typeof session.user & {
    organisationId?: string | null;
    role?: CurrentMember["role"];
    active?: boolean;
  };

  if (!user.organisationId || user.active === false) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organisationId: user.organisationId,
    role: user.role ?? "member",
    demoMode: false,
    storageMode: "postgres",
  };
}
