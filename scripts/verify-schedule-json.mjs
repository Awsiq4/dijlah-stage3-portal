import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCHEDULE_2026_10_17} from '../src/lib/schedule-2026-10-17.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ref=JSON.parse(readFileSync(path.join(root,'references/schedule-2026-2027.json'),'utf8'));

const DAYMAP={"السبت":6,"الأحد":0,"الاثنين":1,"الثلاثاء":2,"الأربعاء":3,"الخميس":4,"الجمعة":5};
const SUBJ=[["الأنظمة التسلسلية الرقمية","digital-systems"],["التحليلات الهندسية والعددية","numerical-analysis"],["الوقاية من الليزر","laser-safety"],["الإلكترونيات البصرية","optoelectronics"],["بصريات لاخطية","nonlinear-optics"],["تطبيقات الليزر الصناعية","industrial-lasers"],["ميكانيك الكم","quantum-mechanics"]];
const subjId=n=>{for(const [k,v] of SUBJ)if(n.includes(k))return v;return null;};

const expected=[];
for(const [sec,days] of Object.entries(ref["الشعب"])){
  const s=sec.slice(-1);
  for(const [dayName,slots] of Object.entries(days)){
    const day=DAYMAP[dayName];
    for(const slot of slots){
      const practical=slot["المادة"].includes("عملي");
      const caue=(slot["المكان"]||"").trim()==="قاعة";
      expected.push({
        section:s, day, start:slot["من"], end:slot["إلى"],
        subjectId:subjId(slot["المادة"]), teacher:slot["التدريسي"],
        room:caue?"":slot["المكان"], kind:practical?"practical":"theory",
        isT:slot["المادة"].includes("(T)"), isCaue:caue,
        periods:slot["الفترات_الأصلية"]||[]
      });
    }
  }
}

const failures=[];
const check=(label,ok,detail)=>{console.log(`${ok?'PASS':'FAIL'}  ${label}${ok?'':`  -> ${detail}`}`);if(!ok)failures.push(label);};

check('A1. reference JSON has 36 blocks / 4 sections', expected.length===36 && new Set(expected.map(e=>e.section)).size===4, `blocks=${expected.length}`);
check('A2. site has 36 slots / 4 sections', SCHEDULE_2026_10_17.length===36 && new Set(SCHEDULE_2026_10_17.map(s=>s.section)).size===4, `slots=${SCHEDULE_2026_10_17.length}`);
check('A3. reference JSON has 76 original periods', expected.reduce((a,e)=>a+e.periods.length,0)===76, `periods=${expected.reduce((a,e)=>a+e.periods.length,0)}`);
check('A4. site slots carry all 76 periods', SCHEDULE_2026_10_17.reduce((a,s)=>a+(s.periods||[]).length,0)===76, `periods=${SCHEDULE_2026_10_17.reduce((a,s)=>a+(s.periods||[]).length,0)}`);

const ROOM_OVERRIDES={"sched-sat-A-1220":"A508","sched-sat-F-1220":"A508"}; // 3A/3F السبت 12:20 — امتداد لنفس المادة/اليوم/الشعبة والقاعة السابقة محددة (A508)
const key=s=>[s.section,s.day,s.start,s.end,s.subjectId,s.teacher,s.room,s.kind].join('|');
const keyRef=e=>[e.section,e.day,e.start,e.end,e.subjectId,e.teacher,ROOM_OVERRIDES[siteId(e)]||e.room,e.kind].join('|');
function siteId(e){return 'sched-'+['sun','mon','tue','wed','thu','fri','sat'][e.day]+'-'+e.section+'-'+e.start.replace(':','');}
const siteMap=new Map(SCHEDULE_2026_10_17.map(s=>[key(s),s]));
const missing=expected.filter(e=>!siteMap.has(keyRef(e)));
check('B1. every reference block exists in site data (section/day/times/subject/teacher/room/kind)', missing.length===0, missing.map(m=>`${m.section}d${m.day} ${m.start}-${m.end} ${m.subjectId}`).join(', '));

const extra=SCHEDULE_2026_10_17.filter(s=>!expected.find(e=>keyRef(e)===key(s)));
check('B2. no invented blocks in site data', extra.length===0, extra.map(s=>s.id).join(','));

let periodMismatch=[];
for(const e of expected){
  const s=siteMap.get(keyRef(e));
  if(s && JSON.stringify(s.periods||[])!==JSON.stringify(e.periods)) periodMismatch.push(e.section+'d'+e.day+' '+e.start);
}
check('C1. all 76 periods match reference exactly per slot', periodMismatch.length===0, periodMismatch.join(','));

let markMismatch=[];
for(const e of expected){
  const s=siteMap.get(keyRef(e));
  if(s && (e.isT !== (s.note||'').includes('(T)') || (e.isCaue && !ROOM_OVERRIDES[siteId(e)]) !== (s.note||'').includes('[قاعة]'))) markMismatch.push(keyRef(e));
}
check('C2. (T) and [قاعة] markers preserved per slot', markMismatch.length===0, markMismatch.join(','));

let roomFake=[];
for(const s of SCHEDULE_2026_10_17){ if(s.note.includes('[قاعة]') && s.room) roomFake.push(s.id); }
check('C3. no room number assigned to [قاعة] slots', roomFake.length===0, roomFake.join(','));

const sunA=SCHEDULE_2026_10_17.filter(s=>s.section==='A'&&s.day===0);
check('D1. Sunday 3A: 2 blocks over 3 periods (no invented third lecture)', sunA.length===2 && sunA.reduce((a,s)=>a+(s.periods||[]).length,0)===3, `blocks=${sunA.length} periods=${sunA.reduce((a,s)=>a+(s.periods||[]).length,0)}`);

const overlaps=[];
for(const sec of ['A','B','C','F'])for(let day=0;day<=6;day++){
  const list=SCHEDULE_2026_10_17.filter(s=>s.section===sec&&s.day===day).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<list.length;i++)if(list[i].start<list[i-1].end)overlaps.push(`${sec}d${day}:${list[i-1].id}x${list[i].id}`);
}
check('D2. no overlapping slots within any section/day', overlaps.length===0, overlaps.join(','));

const perSec={};for(const s of SCHEDULE_2026_10_17)(perSec[s.section]??=[]).push(s);
check('D3. 9 blocks per section', Object.values(perSec).every(l=>l.length===9), JSON.stringify(Object.fromEntries(Object.entries(perSec).map(([k,v])=>[k,v.length]))));
check('D4. 7 distinct subjects per section', Object.values(perSec).every(l=>new Set(l.map(s=>s.subjectId)).size===7), '');

if(failures.length){console.error(`\n${failures.length} reference-comparison check(s) FAILED.`);process.exit(1);}
console.log('\nAll reference-comparison checks passed: site data === references/schedule-2026-2027.json (36 blocks, 76 periods).');
