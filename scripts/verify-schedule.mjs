import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCHEDULE_2026_10_17} from '../src/lib/schedule-2026-10-17.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const slots=SCHEDULE_2026_10_17;
const SECTIONS=['A','B','C','F'];
const DAYS_OFF=[1,4,5];
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
const ROOM=/^$|^[A-Z]\d{3}$/;

function parseCsvLine(line){
  const cells=[];let cur='';let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(inQ){
      if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else inQ=false;}
      else cur+=ch;
    }else if(ch==='"')inQ=true;
    else if(ch===','){cells.push(cur);cur='';}
    else cur+=ch;
  }
  cells.push(cur);
  return cells;
}

const teacherRows=readFileSync(path.join(root,'data/teachers-template.csv'),'utf8').split(/\r?\n/).filter(Boolean).slice(1).map(parseCsvLine);
const subjectTeachers={};
for(const row of teacherRows){
  const [subjectId,,teacherField]=row;
  subjectTeachers[subjectId]=teacherField.split('/').map(part=>{
    const m=part.trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m?{name:m[1].trim(),role:m[2].trim()}:{name:part.trim(),role:''};
  }).filter(t=>t.name);
}

const failures=[];
function check(label,ok,detail){
  console.log(`${ok?'PASS':'FAIL'}  ${label}${ok?'':`  -> ${detail}`}`);
  if(!ok)failures.push(label);
}

check('1. total slot count is 36',slots.length===36,`got ${slots.length}`);

const bySection={};for(const s of slots)(bySection[s.section]??=[]).push(s);
check('2. every section A/B/C/F has exactly 9 slots',
  SECTIONS.every(sec=>(bySection[sec]||[]).length===9),
  JSON.stringify(Object.fromEntries(SECTIONS.map(sec=>[sec,(bySection[sec]||[]).length]))));

check('3. every section covers exactly 7 distinct subjects',
  SECTIONS.every(sec=>new Set((bySection[sec]||[]).map(s=>s.subjectId)).size===7),
  JSON.stringify(Object.fromEntries(SECTIONS.map(sec=>[sec,new Set((bySection[sec]||[]).map(s=>s.subjectId)).size]))));

const badTeacher=slots.filter(s=>{
  const list=subjectTeachers[s.subjectId];
  return !list||!list.some(t=>t.name===s.teacher);
});
check('4. teacher matches the subject per data/teachers-template.csv',badTeacher.length===0,
  badTeacher.map(s=>`${s.id}:${s.teacher}`).join(', ')||'none');

const badKind=slots.filter(s=>{
  if(s.kind!=='theory'&&s.kind!=='practical')return true;
  const entry=(subjectTeachers[s.subjectId]||[]).find(t=>t.name===s.teacher);
  if(entry&&entry.role)return (entry.role==='نظري')!==(s.kind==='theory');
  return false;
});
check('5. kind is theory/practical and consistent with the teacher role marker',badKind.length===0,
  badKind.map(s=>`${s.id}:${s.kind}/${s.teacher}`).join(', ')||'none');

const badTime=slots.filter(s=>!HHMM.test(s.start)||!HHMM.test(s.end)||s.end<=s.start||!Number.isInteger(s.day)||s.day<0||s.day>6||DAYS_OFF.includes(s.day));
check('6. valid HH:mm times with end>start, day 0-6, and no slots on Mon/Thu/Fri (days 1,4,5)',badTime.length===0,
  badTime.map(s=>`${s.id}:${s.day} ${s.start}-${s.end}`).join(', ')||'none');

const overlaps=[];
for(const sec of SECTIONS){
  for(let day=0;day<=6;day++){
    const list=(bySection[sec]||[]).filter(s=>s.day===day).sort((a,b)=>a.start.localeCompare(b.start));
    for(let i=1;i<list.length;i++)if(list[i].start<list[i-1].end)overlaps.push(`${sec} day${day}: ${list[i-1].id} x ${list[i].id}`);
  }
}
check('7. no overlapping time ranges within the same section and day',overlaps.length===0,overlaps.join(', ')||'none');

const ids=slots.map(s=>s.id);
check('8. slot ids are unique',new Set(ids).size===ids.length,`duplicates: ${ids.filter((id,i)=>ids.indexOf(id)!==i).join(',')||'none'}`);

const badRoom=slots.filter(s=>!ROOM.test(s.room));
check('9. room format is empty or letter+3 digits (e.g. A508)',badRoom.length===0,
  badRoom.map(s=>`${s.id}:${s.room}`).join(', ')||'none');


const totalPeriods=slots.reduce((a,s)=>a+(s.periods||[]).length,0);
check('10. all 76 original 45-min periods present', totalPeriods===76, `periods=${totalPeriods}`);
const badPeriods=slots.filter(s=>(s.periods||[]).some(p=>{const m=/^(\d+):(\d+)-(\d+):(\d+)$/.exec(p);if(!m)return true;const t=x=>+x[0]*60+ +x[1];const [a,b,c,d]=m.slice(1);return t([a,b])<t([s.start.split(":")[0],s.start.split(":")[1]])||t([c,d])>t([s.end.split(":")[0],s.end.split(":")[1]]);}));
check('11. every period fits inside its slot start/end', badPeriods.length===0, badPeriods.map(s=>s.id).join(',')||'none');

const sunA=slots.filter(s=>s.section==='A'&&s.day===0);
check('12. Sunday 3A: 2 blocks over 3 periods (blocks vs periods distinguished)', sunA.length===2&&sunA.reduce((a,s)=>a+(s.periods||[]).length,0)===3, `blocks=${sunA.length} periods=${sunA.reduce((a,s)=>a+(s.periods||[]).length,0)}`);

if(failures.length){console.error(`\n${failures.length} schedule check(s) FAILED.`);process.exit(1);}
console.log('\nAll schedule checks passed for SCHEDULE_2026_10_17.');
