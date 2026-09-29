import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep PostCSS/Tailwind looking at this app, not the parent Pdf-Analyzer folder.
  turbopack: {
    root: dir,
  },
};

export default nextConfig;
