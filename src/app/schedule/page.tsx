"use client";
import {useEffect,useState} from "react";
import {CalendarDays} from "lucide-react";
import {useDetailAnchor} from "@/lib/use-detail-anchor";
import {usePortal} from "@/lib/storage";
import {DAYS,getSubject} from "@/lib/seed";
import {Empty,PageHeading,Status} from "@/components/UI";

const DAY_ORDER=[6,0,1,2,3]; // السبت، الأحد، الاثنين، الثلاثاء، الأربعاء
const SECTION_LABELS:Record<string,string>={A:"3A",B:"3B",C:"3C",F:"3F"};

export default function Schedule(){
 const {data,section}=usePortal();
 const todayKey=new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"Asia/Baghdad"}).format(new Date());
 const map:Record<string,number>={Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6};
 const [day,setDay]=useState(DAY_ORDER.includes(map[todayKey]??0)?map[todayKey]!:6);
 const [view,setView]=useState<"day"|"week">("day");
 useEffect(()=>{
  try{
   const requested = new URLSearchParams(window.location.search).get("day");
   if(requested !== null && /^[0-6]$/.test(requested)){setDay(Number(requested));return;}
   if(window.matchMedia("(min-width:1081px)").matches)setView("week");
  }catch(e){}
 },[]);
 useDetailAnchor(data.schedule, day, view);
 const slots=data.schedule.filter(s=>s.section===section&&s.day===day).sort((a,b)=>a.start.localeCompare(b.start));
 const displayName=(s:{subjectId:string;kind:string;note:string})=>{
  const base=getSubject(data,s.subjectId)?.name||"مادة غير معرّفة";
  return s.kind==="practical"?`${base} – عملي`:base;
 };
 return <>
  <PageHeading title="الجدول الأسبوعي" description={`شعبة ${SECTION_LABELS[section]||section} · من جدول 2026-2027 الرقمي المصحّح`}/>
  <div className="view-toggle" role="tablist" aria-label="طريقة العرض">
   <button className={view==="day"?"selected":""} onClick={()=>setView("day")}>عرض يومي</button>
   <button className={view==="week"?"selected":""} onClick={()=>setView("week")}>عرض أسبوعي</button>
  </div>
  <div className="day-picker">{DAY_ORDER.map(n=><button key={n} onClick={()=>{setDay(n);setView("day");}} className={`${day===n&&view==="day"?"active":""} day-${n}`}>{DAYS[n]}{n===1&&<small className="rest-tag">استراحة</small>}</button>)}</div>
  {view==="day"&&<div className="panel"><div className="panel-heading"><h2><CalendarDays size={20}/> {DAYS[day]}</h2><span className="subtle">{day===1?"استراحة الطلبة":`${slots.length} محاضرة · ${slots.reduce((a,s)=>a+(s.periods?.length||1),0)} حصة`}</span></div>
   <div className="panel-body">
    {day===1&&!slots.some(slot=>slot.status!=="normal")?<Empty title="استراحة الطلبة" description="يوم الاثنين يوم استراحة — لا توجد محاضرات في جدول 2026-2027."/>:slots.length?slots.map(slot=><div className={`schedule-row day-accent-${day}`} key={slot.id} id={"slot-"+slot.id}>
     <div className="schedule-time"><strong>{slot.start}</strong><small>{slot.end}</small></div>
     <div className="grow">
      <strong>{displayName(slot)}</strong>
      <div className="subtle small">
       <span className="teacher-name">{slot.teacher||getSubject(data,slot.subjectId)?.teacher||"اسم التدريسي غير متوفر"}</span>
       {slot.room?<> · <span className="room-badge">{slot.room}</span></>:<> · <span className="room-badge empty-room">قاعة غير محددة</span></>}
       · <Status tone={slot.kind==="practical"?"warning":"muted"}>{slot.kind==="practical"?"عملي":"نظري"}</Status>
      </div>
      {slot.note&&!slot.note.includes("(T)")&&!slot.note.includes("[قاعة]")&&<p className="subtle small">{slot.note}</p>}
      {slot.note.includes("[قاعة]")&&<p className="subtle small">[قاعة] في الأصل — القاعة غير محددة</p>}
     </div>
     {slot.status!=="normal"&&<Status tone={slot.status==="cancelled"?"danger":"warning"}>{slot.status==="cancelled"?"ملغاة":slot.status==="extra"?"إضافية":"تغيير"}</Status>}
    </div>):<Empty title="جدول هذا اليوم غير متوفر" description="لا محاضرات لهذا اليوم حسب جدول 2026-2027 المصحّح (الاثنين استراحة، ولا دو��ام الخميس والجمعة)."/>}
   </div></div>}
  {view==="week"&&<div className="panel"><div className="panel-heading"><h2><CalendarDays size={20}/> الأسبوع حسب الشعب</h2></div><div className="panel-body week-body">
   <div className="week-grid">
    <div className="week-head">الشعبة</div>
    {DAY_ORDER.map(n=><div key={n} className={`week-head day-${n}`}>{DAYS[n]}{n===1?" · استراحة":""}</div>)}
    {(["A","B","C","F"] as const).map(sec=><>
     <div className="week-sec" key={sec}>{SECTION_LABELS[sec]}</div>
     {DAY_ORDER.map(n=>{
      const list=data.schedule.filter(s=>s.section===sec&&s.day===n).sort((a,b)=>a.start.localeCompare(b.start));
      return <div key={n} className={`week-cell day-accent-${n}`}>
       {n===1?<span className="subtle small">استراحة</span>:list.length?list.map(s=><div className="week-slot" key={s.id}>
        <span className="week-time" dir="ltr">{s.start}–{s.end}</span>
        <strong>{displayName(s)}</strong>
        <span className="subtle small">{s.teacher}{s.room?` · ${s.room}`:""}</span>
       </div>):<span className="subtle small">—</span>}
      </div>;
     })}
    </>)}
   </div>
  </div></div>}
 </>;
}
