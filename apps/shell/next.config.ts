import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@bobbinry/ui-components', '@bobbinry/manuscript', '@bobbinry/web-publisher', '@bobbinry/smart-publisher'],
};

export default nextConfig;
