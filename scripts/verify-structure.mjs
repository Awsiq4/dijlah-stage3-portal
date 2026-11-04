import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const required=['src/app/page.tsx','src/app/subjects/page.tsx','src/app/subjects/[id]/page.tsx','src/app/lectures/[id]/page.tsx','src/app/schedule/page.tsx','src/app/announcements/page.tsx','src/app/exams/page.tsx','src/app/assignments/page.tsx','src/app/notifications/page.tsx','src/app/admin/page.tsx','src/app/admin/login/page.tsx','src/app/admin-legacy/page.tsx','src/app/more/page.tsx','src/lib/types.ts','src/lib/seed.ts','src/middleware.ts','src/lib/server/auth.ts','src/lib/server/content.ts','database/cloudflare-d1-schema.sql','database/portal-schema.sql','docs/HANDOFF_TO_OTHER_AI.md'];
let failed=false;
for(const file of required){if(!existsSync(path.join(root,file))){console.error('MISSING:',file);failed=true;}}
const shell=readFileSync(path.join(root,'src/components/AppShell.tsx'),'utf8');
for(const need of ['href:"/announcements"','href:"/more"','Aws Faris','toggleDark'])if(!shell.includes(need)){console.error('MISSING NAV FEATURE:',need);failed=true;}
if(failed)process.exit(1);
console.log('Structure and key navigation checks OK. This is not an integration, auth, DB or production test.');
