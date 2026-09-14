import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // deploybase serves static files only — no SSR, no API routes, no image
  // optimisation server. Everything must be prerendered at build time.
  output: 'export',

  // Emits out/<path>/index.html rather than out/<path>.html, which is what
  // static CDNs resolve correctly for extensionless URLs.
  trailingSlash: true,

  images: {
    // next/image's optimiser needs a server; static export requires this off.
    unoptimized: true,
  },

  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
