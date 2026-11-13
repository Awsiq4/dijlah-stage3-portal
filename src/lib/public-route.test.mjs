import {test} from "node:test";
import assert from "node:assert/strict";
import {needsPublicContent} from "./public-route.ts";

test("all student pages that read public data are protected by the same loading gate",()=>{
 for(const path of ["/","/subjects","/subjects/nonlinear-optics","/lectures/example","/questions/example","/schedule",
  "/announcements","/exams","/assignments","/this-week","/notifications"])
  assert.equal(needsPublicContent(path),true,path);
 for(const path of ["/admin","/admin/passkeys","/admin-legacy","/api/public/content",
  "/more","/support","/about-department"])
  assert.equal(needsPublicContent(path),false,path);
});
