const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.imgur.com',
      },
    ],
  },
  // The post-funding emails read their header image from public/post-funding at
  // send time via a per-step path, which file tracing can't follow statically.
  // Email 1 sends from fundLoanAction (underwriting client page), the rest from
  // the cron. Without this the send throws "ENOENT" in production only.
  outputFileTracingIncludes: {
    '/api/cron/post-funding-emails': ['./public/post-funding/*.jpg'],
    '/underwriting/**': ['./public/post-funding/*.jpg'],
  },
  // Baseline security headers on every response. frame-ancestors 'self' stops
  // other sites framing staff pages (clickjacking) while our own PDF/doc
  // iframes keep working. A full script-src CSP is a separate, tested change.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

module.exports = nextConfig;

