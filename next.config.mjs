import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Don't let the service worker hijack API routes or server actions
  exclude: [/^\/api\//, /^\/\/api\//],
  // Disable SW in development — simpler DX (HMR, cache churn) and the prod build
  // is where we actually verify offline behavior anyway.
  disable: process.env.NODE_ENV !== 'production',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
}

export default withSerwist(nextConfig)
