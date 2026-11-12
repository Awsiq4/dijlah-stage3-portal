"use client";

import React,{useEffect,useRef,useState} from "react";
import {upload} from "@vercel/blob/client";
import {Send} from "lucide-react";
import {usePublicationRequest} from "./publication-review";
import type {PublishingAccount} from "./material-form";
import {assignmentDayAllowed,assignmentDisplayDay} from "@/lib/assignment-date";

type Row = Record<string,unknown>;
const ALL = ["A","B","C","F"];
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const savedDate = assignmentDisplayDay;
export function AssignmentForm({account,initial,onSaved}:{
 account:PublishingAccount;initial?:Row;onSaved:()=>void;
}) {
 const {request,review}=usePublicationRequest();
 const teacher=account.role==="teacher";
 const sectionRep=account.role==="section_representative";
 const [subjects,setSubjects]=useState<{id:string;name:string}[]>([]);
 const [subject,setSubject]=useState(String(initial?.subject_id || (teacher && account.assigned_subjects?.length===1 ? account.assigned_subjects[0] : "")));
 const [sections,setSections]=useState<string[]>(
   Array.isArray(initial?.sections) ? initial.sections.map(String) :
   sectionRep && account.assigned_section ? [account.assigned_section] : [...ALL]);
 const [title,setTitle]=useState(String(initial?.title||""));
 const [instructions,setInstructions]=useState(String(initial?.instructions||""));
 const [due,setDue]=useState(initial?.due_at ? savedDate(initial.due_at) : "");
 const [submission,setSubmission]=useState(String(initial?.submission||""));
 const [attachment,setAttachment]=useState(String(initial?.attachment_url||""));
 const [file,setFile]=useState<File>();
 const [status,setStatus]=useState(String(initial?.status||"active"));
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [uploadProgress,setUploadProgress]=useState(0);
 const cache=useRef<{file:File;url:string}|null>(null);
 const id=useRef(String(initial?.id || ""));
 useEffect(()=>{
  let active=true;
  fetch("/api/public/content?type=subjects",{cache:"no-store"})
   .then(r=>r.json()).then(j=>{if(active)setSubjects((j.content?.subjects||[]).map((s:Row)=>({id:String(s.id),name:String(s.name)})));})
   .catch(()=>{if(active)setNotice("تعذر تحميل قائمة المواد.");});
  return ()=>{active=false;};
 },[]);
 const available=teacher?subjects.filter(s=>account.assigned_subjects?.includes(s.id)):subjects;
 const allowed=teacher?ALL.filter(s=>(account.perms?.teacher_sections?.[subject]??ALL).includes(s)):ALL;
 const choices=ALL.filter(s=>!sectionRep || s===account.assigned_section).filter(s=>allowed.includes(s));
 const canAll=allowed.length===ALL.length;
 const selectAll=()=>setSections(canAll&&sections.length===ALL.length?[]:[...allowed]);
 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if(busy)return;
  setNotice("");
  if(!available.some(s=>s.id===subject)||!title.trim()||!instructions.trim()||!sections.length ||
    !sections.every(s=>allowed.includes(s))||
    (sectionRep && sections.length!==ALL.length && (sections.length!==1||sections[0]!==account.assigned_section))) {
    setNotice("اختر المادة والشعب واكتب عنوان التكليف وتعليماته.");return;
  }
  if(!assignmentDayAllowed(due) && !(initial && due===savedDate(initial.due_at))) {
    setNotice("حدد يوماً صحيحاً للتسليم (اليوم أو بعده)، بدون ساعة.");return;
  }
  if(attachment && !/^https:\/\/[^\s]+$/i.test(attachment)) {
    setNotice("رابط المرفق يجب أن يبدأ بـ https://");return;
  }
  setBusy(true);
  try{
   let url=attachment.trim();
   if(file) {
    const ext=/\.pdf$/i.test(file.name)?"pdf":/\.pptx$/i.test(file.name)?"pptx":null;
    const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
    const valid=ext==="pdf"?String.fromCharCode(...bytes)==="%PDF-":
      ext==="pptx"&&bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
    if(!ext||!valid||!file.size||file.size>100*1024*1024) {
      setNotice("المرفق لازم PDF/PPTX صالح، بحجم أقل من 100MB.");return;
    }
    if(cache.current?.file===file)url=cache.current.url;
    else {
     const mime=ext==="pdf"?"application/pdf":PPTX;
     const path="lectures/"+crypto.randomUUID()+"-assignment."+ext;
     const result=await upload(path,file,{
      access:"public",contentType:mime,handleUploadUrl:"/api/admin/upload",
      headers:{"x-portal-admin":"1"},multipart:file.size>5*1024*1024,
      clientPayload:JSON.stringify({filename:file.name,contentType:mime,size:file.size,subjectId:subject,sections}),
      onUploadProgress:({percentage})=>setUploadProgress(Math.round(percentage)),
     });
     url=result.url;cache.current={file,url};
    }
   }
   if(!id.current)id.current="web-"+crypto.randomUUID();
   const row={id:id.current,subject_id:subject,title:title.trim(),instructions:instructions.trim(),
      assigned_at:String(initial?.assigned_at||new Date().toISOString()),
      due_at:due,sections,submission:submission.trim(),attachment_url:url,status};
   const {response,data}=await request("assignments",row);
   if(!response.ok) {setNotice(data.error||"تعذر حفظ التكليف.");return;}
   setNotice("✅ تم حفظ التكليف بنجاح.");
   setFile(undefined);cache.current=null;
   if(!initial) {
     id.current=""; setTitle("");setInstructions("");setDue("");
     setSubmission("");setAttachment("");
     setSections(sectionRep&&account.assigned_section?[account.assigned_section]:[...ALL]);
   }
   onSaved();
  }catch {setNotice("تعذر رفع المرفق أو حفظ التكليف. راجع اتصالك وحاول مجدداً.");}
  finally{setBusy(false);setUploadProgress(0);}
 }
 return <form className="admin-form" onSubmit={save}>
  {review}
  {notice&&<p className="note" role="status" style={{gridColumn:"1/-1"}}>{notice}</p>}
  <label className="form-field"><span>المادة *</span>
   <select value={subject} required onChange={e=>{setSubject(e.target.value);setSections([]);}}>
    <option value="">اختر المادة</option>
    {available.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
   </select>
  </label>
  <label className="form-field"><span>آخر يوم للتسليم *</span>
   <input type="date" required value={due} onChange={e=>setDue(e.target.value)}/>
  </label>
  <label className="form-field wide"><span>عنوان الواجب أو التكليف *</span>
   <input required maxLength={180} value={title} onChange={e=>setTitle(e.target.value)}/>
  </label>
  <label className="form-field wide"><span>التعليمات *</span>
   <textarea required maxLength={3000} rows={4} value={instructions} onChange={e=>setInstructions(e.target.value)}/>
  </label>
  <div className="form-field wide"><span>الشعب المستهدفة *</span>
    <div className="section-pills">
      {canAll&&<label><input type="checkbox" checked={sections.length===ALL.length}
        onChange={selectAll}/> جميع الشعب</label>}
      {choices.map(s=><label key={s}><input type="checkbox" checked={sections.includes(s)}
       onChange={e=>setSections(prev=>e.target.checked?[...new Set([...prev,s])]:prev.filter(x=>x!==s))}/> {s}</label>)}
    </div>
  </div>
  <label className="form-field wide"><span>طريقة التسليم (اختياري)</span>
   <input value={submission} maxLength={500} onChange={e=>setSubmission(e.target.value)} placeholder="مثلاً: ورقي بالمحاضرة"/>
  </label>
  <label className="form-field wide"><span>رابط مرفق (اختياري)</span>
   <input value={attachment} onChange={e=>setAttachment(e.target.value)} placeholder="https://..."/>
  </label>
  <label className="form-field wide"><span>أو ارفع ملف PDF/PPTX (اختياري)</span>
   <input type="file" accept=".pdf,.pptx" onChange={e=>setFile(e.target.files?.[0])}/>
  </label>
  {initial&&<label className="form-field"><span>الحالة</span>
   <select value={status} onChange={e=>setStatus(e.target.value)}>
    <option value="active">نشط</option><option value="closed">منتهٍ</option><option value="cancelled">ملغى</option>
   </select>
  </label>}
  <button className="action-button" disabled={busy} style={{gridColumn:"1/-1",justifySelf:"start"}}>
   <Send size={15}/>{busy ? (uploadProgress?"رفع المرفق "+uploadProgress+"%":"جارٍ الحفظ…"):initial?"حفظ التعديلات":"نشر التكليف"}
  </button>
 </form>;
}
