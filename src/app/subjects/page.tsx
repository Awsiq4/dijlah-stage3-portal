"use client";
import Link from "next/link";
import {ArrowUpLeft,BookOpen,FileText,Search} from "lucide-react";
import {useState} from "react";
import {usePortal} from "@/lib/storage";
import {PageHeading} from "@/components/UI";
export default function Subjects(){const {data}=usePortal();const [q,setQ]=useState("");return <><PageHeading title="المواد الدراسية" description="سبع مواد دراسية للمرحلة الثالثة"/><label className="search"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث عن مادة..." aria-label="ابحث عن مادة"/></label><div className="cards-grid">{data.subjects.filter(s=>(s.name+s.englishName).toLowerCase().includes(q.toLowerCase())).map(s=><Link href={`/subjects/${s.id}`} key={s.id} className="subject-card" style={{"--subject-color":s.color} as React.CSSProperties}><div className="subject-card-icon"><BookOpen size={25}/></div><h2>{s.name}</h2><p>{s.englishName}</p><div className="subject-info"><span>{s.teacher||"اسم التدريسي غير مضاف"}</span><span><FileText size={15}/> {data.lectures.filter(l=>l.subjectId===s.id&&l.status==="published").length} محاضرة</span></div><div className="subject-bottom">فتح المادة <ArrowUpLeft size={16}/></div></Link>)}</div></>}
