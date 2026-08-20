/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenant-ai/shared"],
  experimental: {
    serverComponentsExternalPackages: ["@resvg/resvg-js"],
  },
};

module.exports = nextConfig;
