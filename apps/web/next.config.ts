import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  transpilePackages: ['@tally/domain', '@tally/db'],
  typedRoutes: true,
  // Uploads are capped at 4 MB by services (Vercel body limit 4.5 MB); leave room for form fields.
  experimental: { serverActions: { bodySizeLimit: '4.5mb' } },
  // The acts registry left Payroll for its own page (A-087); old links and bookmarks still work.
  redirects: () =>
    Promise.resolve([
      { source: '/payroll/acts', destination: '/acts', permanent: true },
      { source: '/payroll/acts/:path*', destination: '/acts/:path*', permanent: true },
    ]),
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
