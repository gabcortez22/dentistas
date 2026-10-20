import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg", "@react-pdf/renderer"],
};

export default config;
