import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { googleEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return <LoginForm next={next} initialError={error} google={googleEnabled()} />;
}
