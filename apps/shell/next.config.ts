import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@bobbinry/ui-components', '@bobbinry/manuscript', '@bobbinry/corkboard', '@bobbinry/web-publisher', '@bobbinry/smart-publisher'],
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
