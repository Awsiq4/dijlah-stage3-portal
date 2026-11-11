/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {key: "X-Content-Type-Options", value: "nosniff"},
          {key: "X-Frame-Options", value: "DENY"},
          {key: "Referrer-Policy", value: "strict-origin-when-cross-origin"},
          {key: "Content-Security-Policy", value: [
            "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
            "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
            "script-src-attr 'none'",
          ].join("; ")},
        ],
      },
      ...["/admin/:path*", "/admin-legacy/:path*", "/api/admin/:path*", "/api/telegram/:path*", "/api/support/:path*"].map(source => ({
        source,
        headers: [
          {key: "Cache-Control", value: "private, no-store"},
          {key: "Referrer-Policy", value: "no-referrer"},
          {key: "X-Robots-Tag", value: "noindex, nofollow"},
        ],
      })),
    ];
  },
};

export default config;
