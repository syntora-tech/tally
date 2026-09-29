import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tally/domain', '@tally/db'],
  typedRoutes: true,
};

export default nextConfig;
