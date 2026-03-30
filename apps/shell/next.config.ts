import type { NextConfig } from "next";
import { execSync } from "child_process";

// Build ID derived from git — deterministic and meaningful in logs.
// Falls back to a timestamp if git isn't available (e.g. Docker builds without .git).
let buildId: string
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  buildId = Date.now().toString(36)
}

const nextConfig: NextConfig = {
  generateBuildId: () => buildId,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  ...(process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_APP_URL
    ? { allowedDevOrigins: [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname] }
    : {}),
  transpilePackages: ['@bobbinry/ui-components', '@bobbinry/manuscript', '@bobbinry/corkboard', '@bobbinry/cat', '@bobbinry/web-publisher'],
  async redirects() {
    return [
      {
        source: '/marketplace',
        destination: '/bobbins',
        permanent: true,
      },
      {
        source: '/projects/:projectId/marketplace',
        destination: '/projects/:projectId/bobbins',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
