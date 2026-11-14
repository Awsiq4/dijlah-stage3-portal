import type {MetadataRoute} from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "بوابة المرحلة الثالثة",
    short_name: "بوابة المرحلة الثالثة",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#182848",
    icons: [
      {src: "/icons/portal-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
      {src: "/icons/portal-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
      {src: "/icons/portal-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable"},
    ],
  };
}
