import "server-only";
import { Google, generateCodeVerifier, generateState, decodeIdToken } from "arctic";
import { env, googleEnabled } from "@/lib/env";

export function googleClient() {
  if (!googleEnabled()) throw new Error("Google SSO is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  return new Google(env().GOOGLE_CLIENT_ID, env().GOOGLE_CLIENT_SECRET, `${env().APP_URL}/api/auth/google/callback`);
}

export function googleAuthorizationUrl() {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);
  if (env().GOOGLE_ALLOWED_DOMAIN) url.searchParams.set("hd", env().GOOGLE_ALLOWED_DOMAIN);
  return { url: url.toString(), state, codeVerifier };
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
  hd?: string;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
  const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? "").toLowerCase(),
    emailVerified: Boolean(claims.email_verified),
    name: String(claims.name ?? claims.email ?? ""),
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    hd: typeof claims.hd === "string" ? claims.hd : undefined,
  };
}
