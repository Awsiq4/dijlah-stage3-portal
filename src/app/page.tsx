"use client";
import Link from "next/link";
import {ArrowUpLeft,BookOpen,CalendarDays,ClipboardList,Megaphone,MessageSquareText,UploadCloud} from "lucide-react";
import {usePortal} from "@/lib/storage";
import {DAYS,formatDate,getSubject} from "@/lib/seed";
import {Badge,Empty,PageHeading,SectionCard,Status} from "@/components/UI";
export default function Home(){
 const {data,section}=usePortal();
 const now=new Date();const today=new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"Asia/Baghdad"}).format(now);
 const dayMap:Record<string,number>={Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6};
 const day=dayMap[today]??0;
 const slots=data.schedule.filter(s=>s.section===section&&s.day===day).sort((a,b)=>a.start.localeCompare(b.start));
 const announcements=data.announcements.filter(a=>a.scope==="general"||a.section==="all"||a.section===section).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt)).slice(0,3);
 const exams=data.exams.filter(e=>e.sections.includes(section)&&e.status!=="cancelled"&&e.date>=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit"}).format(now)).sort((a,b)=>a.date.localeCompare(b.date));
 const assignments=data.assignments.filter(a=>a.sections.includes(section)&&a.status==="active").sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,3);
 const lectures=[...data.lectures].filter(l=>l.status==="published").sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,3);
 return <><div className="hero"><div><Badge>السنة الدراسية 2026–2027</Badge><h1>كل أمور المرحلة الثالثة، بمكان واحد.</h1><p>المحاضرات والجدول والتبليغات والواجبات، بتصميم واضح ومناسب للموبايل.</p><Link className="hero-button" href="/announcements">تصفّح التبليغات <ArrowUpLeft size={18}/></Link></div><div className="hero-decor"><BookOpen size={70} strokeWidth={1.2}/><span>III</span></div></div>
 <PageHeading title="الرئيسية" description={`${DAYS[day]} · الشعبة ${section} · المرحلة الثالثة`}/>
 <div className="stats"><Link href="/subjects" className="stat"><BookOpen size={21}/><span>المواد الدراسية</span><strong>{data.subjects.length}</strong></Link><Link href="/announcements" className="stat"><MessageSquareText size={21}/><span>التبليغات</span><strong>{data.announcements.length}</strong></Link><Link href="/schedule" className="stat"><CalendarDays size={21}/><span>محاضرات اليوم</span><strong>{slots.length}</strong></Link><Link href="/assignments" className="stat"><ClipboardList size={21}/><span>واجبات نشطة</span><strong>{assignments.length}</strong></Link></div>
 <div className="two-col"><SectionCard title="محاضرات اليوم" href="/schedule" subtitle={`جدول يوم ${DAYS[day]} · الشعبة ${section}`}>{slots.length?slots.map(x=><div className="list-row" key={x.id}><div className="time-box">{x.start}<small>{x.end}</small></div><div className="grow"><strong>{getSubject(data,x.subjectId)?.name||"مادة غير محددة"}</strong><div className="subtle small">{x.room||"القاعة غير محددة"} · {x.kind==="practical"?"عملي":"نظري"}</div></div>{x.status!=="normal"&&<Status tone="warning">{x.status==="cancelled"?"ملغاة":"تغيير"}</Status>}</div>):<Empty description="جدول اليوم غير متوفر بهذه النسخة؛ يحتاج استيراد مواعيد الجدول الأصلية."/>}</SectionCard>
 <SectionCard title="آخر التبليغات" href="/announcements">{announcements.length?announcements.map(a=><Link href="/announcements" className="list-row" key={a.id}><div className="round-icon"><Megaphone size={18}/></div><div className="grow"><strong>{a.title}</strong><div className="subtle small">{a.author||"مصدر غير محدد"} · {formatDate(a.publishedAt)}</div></div><ArrowUpLeft size={17}/></Link>):<Empty/>}</SectionCard></div>
 <div className="two-col"><SectionCard title="الامتحان القادم" href="/exams">{exams.length?<div className="highlight-item"><strong>{exams[0].title}</strong><p className="subtle">{getSubject(data,exams[0].subjectId)?.name} · {formatDate(exams[0].date)} · {exams[0].startTime}</p><Status tone="info">{exams[0].status==="confirmed"?"مؤكد":"مؤقت"}</Status></div>:<Empty description="لم تُسجَّل امتحانات مؤكدة أو مؤقتة للشعبة حالياً."/>}</SectionCard><SectionCard title="التكاليف القريبة" href="/assignments">{assignments.length?assignments.map(a=><div className="list-row" key={a.id}><ClipboardList size={18}/><div className="grow"><strong>{a.title}</strong><p className="subtle small">التسليم: {formatDate(a.dueAt)}</p></div></div>):<Empty/>}</SectionCard></div>
 <SectionCard title="آخر المحاضرات" href="/subjects">{lectures.length?lectures.map(l=><Link href={`/lectures/${l.id}`} key={l.id} className="list-row"><div className="round-icon"><UploadCloud size={18}/></div><div className="grow"><strong>{l.title}</strong><div className="subtle small">{getSubject(data,l.subjectId)?.name} · {formatDate(l.updatedAt)}</div></div><ArrowUpLeft size={17}/></Link>):<Empty description="ارفع المحاضرات أو أضف روابطها من لوحة الإدارة التجريبية."/>}</SectionCard>
 </>;
}
