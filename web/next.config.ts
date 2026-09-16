import type { NextConfig } from "next";

const backendOrigin = process.env.HARNESS_API_ORIGIN ?? "http://127.0.0.1:8400";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${backendOrigin}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
