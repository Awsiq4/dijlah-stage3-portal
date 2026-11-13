"use client";
import {useEffect,useState} from "react";
import {Megaphone,Pin} from "lucide-react";
import {usePortal} from "@/lib/storage";
import {PageHeading,Empty,Status} from "@/components/UI";
import {formatDate,getSubject} from "@/lib/seed";
const categories=[{id:"all",label:"الكل"},{id:"general",label:"تبليغات عامة"},{id:"section",label:"تبليغات الشعبة"},{id:"teacher",label:"تبليغات التدريسيين"}];
export default function Announcements(){const {data,section}=usePortal();const [category,setCategory]=useState("all");const visible=data.announcements.filter(a=>(category==="all"||a.scope===category)&&(a.scope==="general"||a.section==="all"||a.section===section)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt));useEffect(() => {
  const hash = window.location.hash;
  if (!hash.startsWith("#announcement-")) return;
  try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({block: "center"}); } catch { /* ignore malformed hashes */ }
}, [data, section, category]);
return <><PageHeading title="التبليغات" description="تبليغات الممثل العام، ممثل الشعبة، وتدريسيي المواد"/><div className="tabs">{categories.map(t=><button className={category===t.id?"selected":""} key={t.id} onClick={()=>setCategory(t.id)}>{t.label}</button>)}</div><div className="stack">{visible.length?visible.map(a=><article className="panel announcement" key={a.id} id={"announcement-" + a.id}><div className="panel-heading"><div className="ann-title"><Megaphone size={19}/><div><strong>{a.title}</strong><p className="subtle small">{a.scope==="general"?"تبليغ عام":a.scope==="section"?`شعبة ${a.section}`:`تدريسي ${getSubject(data,a.subjectId)?.name||"المادة"}`} · {a.author||"لم يُذكر الناشر"} · {formatDate(a.publishedAt)}</p></div></div><div className="status-group">{a.pinned&&<Pin size={17}/>}<Status tone={a.priority==="urgent"?"danger":a.priority==="important"?"warning":"muted"}>{a.priority==="urgent"?"عاجل":a.priority==="important"?"مهم":"عادي"}</Status></div></div><p className="ann-body">{a.body}</p></article>):<Empty title="ماكو تبليغات منشورة حالياً" description="التبليغات الجديدة من ممثلي الشعب والتدريسيين راح تظهر هنا."/>}</div></>}
