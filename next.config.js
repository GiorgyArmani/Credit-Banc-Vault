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
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

module.exports = nextConfig;

