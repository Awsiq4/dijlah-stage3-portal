import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const required=['src/app/page.tsx','src/app/subjects/page.tsx','src/app/subjects/[id]/page.tsx','src/app/lectures/[id]/page.tsx','src/app/schedule/page.tsx','src/app/announcements/page.tsx','src/app/exams/page.tsx','src/app/assignments/page.tsx','src/app/notifications/page.tsx','src/app/admin/page.tsx','src/app/admin/login/page.tsx','src/app/admin-legacy/page.tsx','src/app/more/page.tsx','src/lib/types.ts','src/lib/seed.ts','src/middleware.ts','src/lib/server/auth.ts','src/lib/server/content.ts','database/cloudflare-d1-schema.sql','database/portal-schema.sql','docs/HANDOFF_TO_OTHER_AI.md','src/app/api/public/content/route.ts','src/lib/server/public.ts','src/lib/server/public-filters.ts','src/lib/public-map.ts','scripts/e2e-publish-test.mjs','scripts/migrate-seed-to-db.mjs','scripts/create-super-admin.mjs','scripts/apply-portal-schema.mjs','scripts/vercel-set-env.mjs','scripts/bootstrap-neon-phase1.sh','docs/PHASE1_2_AUTOMATION.md','database/portal-rbac.sql','src/lib/server/rbac.ts','src/lib/server/publish.ts','src/lib/server/bot.ts','src/app/admin/workspace.tsx','src/app/admin/setup/page.tsx','src/app/api/admin/users/route.ts','src/app/api/admin/setup/route.ts','src/app/api/telegram/link/route.ts','src/lib/server/storage.ts','scripts/apply-portal-rbac.mjs','scripts/verify-preview-live.mjs','docs/PHASE3_LIVE_VERIFICATION.md','src/app/api/admin/upload/route.ts','src/lib/server/publish.test.mjs','src/app/api/admin/audit/route.ts','src/lib/server/notify.test.mjs','docs/OWNER_GUIDE.md','docs/BOT_AUDIT_AND_PLAN.md','docs/PHASE2_RBAC_TELEGRAM.md'];
let failed=false;
for(const file of required){if(!existsSync(path.join(root,file))){console.error('MISSING:',file);failed=true;}}
const shell=readFileSync(path.join(root,'src/components/AppShell.tsx'),'utf8');
for(const need of ['href:"/announcements"','href:"/more"','Aws Faris','toggleDark'])if(!shell.includes(need)){console.error('MISSING NAV FEATURE:',need);failed=true;}
const mw=readFileSync(path.join(root,'src/middleware.ts'),'utf8');
for(const need of ['/admin-legacy/:path*','/api/admin/:path*','/admin/:path*','admin-legacy'])if(!mw.includes(need)){console.error('MISSING MIDDLEWARE GATE:',need);failed=true;}
const db=readFileSync(path.join(root,'src/lib/server/db.ts'),'utf8');
if(db.includes('rejectUnauthorized: false')){console.error('INSECURE TLS: db.ts disables certificate verification');failed=true;}
import {readdirSync} from 'node:fs';
for(const f of readdirSync(path.join(root,'scripts'))){if(f==='verify-structure.mjs')continue;const t=readFileSync(path.join(root,'scripts',f),'utf8');if(t.includes('rejectUnauthorized: false')){console.error('INSECURE TLS in script:',f);failed=true;}}
if(failed)process.exit(1);
console.log('Structure and key navigation checks OK. This is not an integration, auth, DB or production test.');
