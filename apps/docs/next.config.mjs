import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // Served at https://semestra.jyleo.cc/docs, next to the app; keep in sync with src/lib/shared.ts.
  basePath: '/docs',
  reactStrictMode: true,
};

export default withMDX(config);
