import type {MetadataRoute} from "next";
import {getPublicContent} from "@/lib/server/public";

export const dynamic="force-dynamic";
const site="https://dj3.top";
const paths=["/","/subjects","/schedule","/announcements",
  "/assignments","/exams","/this-week","/about-department","/install","/support"];

export default async function sitemap():Promise<MetadataRoute.Sitemap> {
  const base:MetadataRoute.Sitemap=paths.map(path=>({
    url:site+path,changeFrequency:path==="/announcements"?"daily":"weekly",priority:path==="/"?1:0.6,
  }));
  try {
    const result=await getPublicContent("subjects","A");
    if(result.fromDatabase)for(const s of result.content.subjects||[]) {
      if(typeof s.id==="string" && /^[a-z0-9-]{1,100}$/i.test(s.id))
        base.push({url:site+"/subjects/"+encodeURIComponent(s.id),changeFrequency:"weekly",priority:0.7});
    }
  }catch {
    // A temporary database outage must not break the public static sitemap.
  }
  return base;
}
