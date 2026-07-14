/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'puppeteer'],
  },
};

export default nextConfig;
