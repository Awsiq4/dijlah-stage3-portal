import type {MetadataRoute} from "next";

export default function robots():MetadataRoute.Robots {
  return {
    rules:[{userAgent:"*",allow:"/",disallow:[
      "/admin","/admin-legacy","/api/","/login","/reset-password","/account",
    ]}],
    sitemap:"https://dj3.top/sitemap.xml",
    host:"https://dj3.top",
  };
}
