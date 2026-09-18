import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { googleEnabled } from "@/lib/env";
import { getActor } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getActor()) redirect("/dashboard");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return <LoginForm next={next} initialError={error} google={googleEnabled()} />;
}
