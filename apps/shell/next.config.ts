import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname] : [],
  transpilePackages: ['@bobbinry/ui-components', '@bobbinry/manuscript', '@bobbinry/corkboard', '@bobbinry/cat', '@bobbinry/web-publisher', '@bobbinry/smart-publisher'],
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
