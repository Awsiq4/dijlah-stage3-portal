import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCHEDULE_2026_10_17} from '../src/lib/schedule-2026-10-17.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE='جدول المحاضرات الأسبوعي 17-10-2026';

function csvCell(value){
  const text=String(value??'');
  return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}

const header='section,day_sun0,start_HHmm,end_HHmm,subject_id,teacher,room,kind_theory_or_practical,status,note,source';
const rows=SCHEDULE_2026_10_17.map(s=>[s.section,s.day,s.start,s.end,s.subjectId,s.teacher,s.room,s.kind,s.status,s.note,SOURCE].map(csvCell).join(','));
const out=path.join(root,'data/schedule-2026-10-17.csv');
writeFileSync(out,[header,...rows].join('\n')+'\n','utf8');
console.log(`Wrote ${rows.length} rows to ${path.relative(root,out)}`);
