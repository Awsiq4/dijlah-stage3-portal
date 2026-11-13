"use client";

import React,{useEffect,useRef,useState} from "react";
import {Send} from "lucide-react";
import {usePublicationRequest} from "./publication-review";
import type {PublishingAccount} from "./material-form";

type Row = Record<string,unknown>;
const ALL=["A","B","C","F"];
const TYPES=["كوز يومي","Midterm","Final"];
const isValidDay=(value:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [y,m,d]=value.split("-").map(Number),dt=new Date(Date.UTC(y,m-1,d));
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
};

export function ExamForm({account,initial,mode="quiz",onSaved}:{
 account:PublishingAccount;initial?:Row;mode?:"quiz"|"schedule";onSaved:()=>void;
}) {
 const {request,review}=usePublicationRequest();
 const teacher=account.role==="teacher",rep=account.role==="section_representative";
 const schedule=mode==="schedule"&&account.role==="super_admin";
 const types=schedule?TYPES.slice(1):TYPES.slice(0,1);
 const defaultKind=types[0];
 const [subjects,setSubjects]=useState<{id:string;name:string}[]>([]);
 const [subject,setSubject]=useState(String(initial?.subject_id||(teacher&&account.assigned_subjects?.length===1?account.assigned_subjects[0]:"")));
 const [sections,setSections]=useState<string[]>(Array.isArray(initial?.sections)?initial.sections.map(String):rep&&account.assigned_section?[account.assigned_section]:[...ALL]);
 const [title,setTitle]=useState(String(initial?.title||""));
 const [kind,setKind]=useState(String(initial?.type||defaultKind));
 const [date,setDate]=useState(String(initial?.date||""));
 const [time,setTime]=useState(String(initial?.start_time||""));
 const [room,setRoom]=useState(String(initial?.room||""));
 const [topics,setTopics]=useState(String(initial?.topics||""));
 const [notes,setNotes]=useState(String(initial?.notes||""));
 const [status,setStatus]=useState(String(initial?.status||"provisional"));
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const id=useRef(String(initial?.id||""));

 useEffect(()=>{
  let active=true;
  fetch("/api/public/content?type=subjects",{cache:"no-store"})
   .then(r=>{if(!r.ok)throw Error();return r.json();})
   .then(j=>{if(active)setSubjects((j.content?.subjects||[]).map((s:Row)=>({id:String(s.id),name:String(s.name)})));})
   .catch(()=>{if(active)setNotice("تعذّر تحميل قائمة المواد.");});
  return()=>{active=false;};
 },[]);
 const available=teacher?subjects.filter(s=>account.assigned_subjects?.includes(s.id)):subjects;
 const allowed=teacher?ALL.filter(s=>(account.perms?.teacher_sections?.[subject]??ALL).includes(s)):ALL;
 const choices=rep?allowed.filter(s=>s===account.assigned_section):allowed;
 const isAll=sections.length===ALL.length&&ALL.every(s=>sections.includes(s));

 async function save(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(busy)return;
  setNotice("");
  if(!available.some(s=>s.id===subject)||!title.trim()||title.trim().length>180||
    (!types.includes(kind)&&!(schedule&&kind===initial?.type))||!sections.length||!sections.every(s=>allowed.includes(s))||
    (rep&&!isAll&&(sections.length!==1||sections[0]!==account.assigned_section))) {
    setNotice("اختَر المادة والشعب والنوع واكتب عنواناً صحيحاً.");return;
  }
  if(!isValidDay(date)||(schedule&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))){
    setNotice(schedule?"حدد تاريخاً ووقتاً صحيحين للامتحان.":"حدد تاريخاً صحيحاً للكوز.");return;
  }
  if(!initial && Date.parse(date+(schedule?"T"+time+":00+03:00":"T23:59:59+03:00"))<=Date.now()){
    setNotice("يجب أن يكون الامتحان الجديد بموعد قادم.");return;
  }
  if(room.length>120||topics.length>3000||notes.length>3000){
    setNotice("التفاصيل أطول من المسموح.");return;
  }
  setBusy(true);
  try {
   if(!id.current)id.current="web-"+crypto.randomUUID();
   const row={id:id.current,subject_id:subject,title:title.trim(),type:kind.trim(),date,
     start_time:schedule?time:"",room:room.trim(),topics:topics.trim(),notes:notes.trim(),sections,status};
   const {response,data}=await request("exams",row,{editing:Boolean(initial),subject:available.find(item=>item.id===subject)?.name});
   if(data.cancelled)return;
   if(!response.ok){setNotice(data.error||"تعذّر نشر الامتحان.");return;}
   setNotice(initial?"✅ تم حفظ تعديلات الامتحان.":"✅ تم نشر موعد الامتحان.");
   if(!initial){
    id.current="";setTitle("");setDate("");setTime("");setRoom("");setTopics("");setNotes("");
    setStatus("provisional");setSections(rep&&account.assigned_section?[account.assigned_section]:[...ALL]);
   }
   onSaved();
  }catch{
   setNotice("تعذّر الحفظ. أعد المحاولة من نفس الشاشة.");
  }finally{setBusy(false);}
 }
 return <form className="admin-form" onSubmit={save}>
  {review}
  {notice&&<p className="note" role="status" style={{gridColumn:"1/-1"}}>{notice}</p>}
  <label className="form-field"><span>المادة *</span>
   <select required value={subject} onChange={e=>{setSubject(e.target.value);setSections([]);}}>
    <option value="">اختر المادة</option>
    {available.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
   </select>
  </label>
  <label className="form-field"><span>نوع الامتحان *</span>
    <select required value={kind} disabled={!schedule} onChange={e=>setKind(e.target.value)}>
      {Boolean(initial?.type) && !types.includes(kind) && <option value={kind}>{kind}</option>}
      {types.map(t=><option key={t} value={t}>{t === "Midterm" ? "ميدتيرم" : t === "Final" ? "فاينل" : t}</option>)}
    </select>

  </label>
  <label className="form-field wide"><span>عنوان الامتحان أو الكوز *</span>
   <input required maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثال: امتحان يومي في الفصل الثالث"/>
  </label>
  <label className="form-field"><span>التاريخ *</span>
   <input required type="date" value={date} onChange={e=>setDate(e.target.value)}/>
  </label>
  {schedule && <label className="form-field"><span>وقت البدء (بغداد) *</span>
   <input required type="time" value={time} onChange={e=>setTime(e.target.value)}/>
  </label>}
  <div className="form-field wide"><span>الشعب المشمولة *</span>
   <div className="section-pills">
    {(!teacher||allowed.length===ALL.length)&&<label><input type="checkbox" checked={isAll}
     onChange={e=>setSections(e.target.checked?[...ALL]:[])}/> جميع الشعب</label>}
    {choices.map(s=><label key={s}><input type="checkbox" checked={sections.includes(s)}
     onChange={e=>setSections(prev=>e.target.checked?[...new Set([...prev,s])]:prev.filter(x=>x!==s))}/> {s}</label>)}
   </div>
  </div>
  <label className="form-field"><span>القاعة (اختياري)</span>
   <input maxLength={120} value={room} onChange={e=>setRoom(e.target.value)}/>
  </label>
  <label className="form-field"><span>الحالة *</span>
   <select value={status} onChange={e=>setStatus(e.target.value)}>
    <option value="provisional">مبدئي / غير نهائي</option>
    <option value="confirmed">مؤكد</option>
    {initial&&<option value="cancelled">ملغى</option>}
   </select>
  </label>
  <label className="form-field wide"><span>المواضيع الداخلة (اختياري)</span>
   <textarea rows={3} maxLength={3000} value={topics} onChange={e=>setTopics(e.target.value)}/>
  </label>
  <label className="form-field wide"><span>ملاحظات (اختياري)</span>
   <textarea rows={3} maxLength={3000} value={notes} onChange={e=>setNotes(e.target.value)}/>
  </label>
  <button className="action-button" disabled={busy} style={{gridColumn:"1/-1",justifySelf:"start"}}>
   <Send size={15}/>{busy?"جارٍ الحفظ…":initial?"حفظ التعديلات":"نشر موعد الامتحان"}
  </button>
 </form>;
}
