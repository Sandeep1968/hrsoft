import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets service-layer ForbiddenError / UnauthorizedError render forbidden.tsx / unauthorized.tsx with real 403 / 401 statuses.
  experimental: { authInterrupts: true },
  poweredByHeader: false,
};

export default nextConfig;
