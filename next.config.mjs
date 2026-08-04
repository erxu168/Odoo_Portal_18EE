/** @type {import('next').NextConfig} */

// Content-Security-Policy for the portal — restricts framing only (no
// default-src/script-src, so existing scripts/styles/images are unaffected).
// frame-src allowlist: 'self' + blob:/data: (in-app previews), the YouTube
// privacy-enhanced nocookie host (guided-tutorial video steps), the standard
// YouTube host (WAJ Radio player — the Premium ad-free session lives in its
// cookies, so nocookie would bring ads back), and Google Slides (manufacturing
// worksheet embeds, WoDetail.tsx). frame-ancestors 'self' stops the portal
// being framed elsewhere. Widen only with a reviewed need.
const ContentSecurityPolicy = [
  "frame-src 'self' blob: data: https://www.youtube-nocookie.com https://www.youtube.com https://docs.google.com",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'youtubei.js', '@anthropic-ai/sdk'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'puppeteer', 'youtubei.js', '@anthropic-ai/sdk'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
