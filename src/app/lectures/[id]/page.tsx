"use client";
import Link from "next/link";
import {useParams} from "next/navigation";
import {Download,FileText,ExternalLink as ExternalLinkIcon} from "lucide-react";
import {usePortal} from "@/lib/storage";
import PdfViewer from "@/components/PdfViewer";
import {Empty,PageHeading} from "@/components/UI";
import {formatDate,getSubject} from "@/lib/seed";
export default function Lecture(){const {id}=useParams<{id:string}>();const {data}=usePortal();const lecture=data.lectures.find(l=>l.id===id&&l.status==="published");if(!lecture)return <Empty title="المحاضرة غير موجودة"/>;const subject=getSubject(data,lecture.subjectId);const safeUrl=/^https:\/\//.test(lecture.fileUrl)||lecture.fileUrl.startsWith("/");return <><Link className="back-link" href={`/subjects/${lecture.subjectId}`}>{subject?.name} ←</Link><PageHeading title={lecture.title} description={`المحاضرة ${lecture.number} · آخر تحديث ${formatDate(lecture.updatedAt)}`}/><div className="panel"><div className="panel-body"><p>{lecture.description||"لا يوجد وصف"}</p><div className="pdf-toolbar"><FileText size={20}/><strong>{lecture.fileName||"ملف المحاضرة"}</strong>{safeUrl&&<a className="action-button" target="_blank" rel="noopener noreferrer" href={lecture.fileUrl}><Download size={16}/> عرض / تحميل</a>}</div>{safeUrl?lecture.fileUrl.toLowerCase().includes(".pdf")?<PdfViewer src={lecture.fileUrl} fileName={lecture.fileName}/>:<p className="subtle"><ExternalLinkIcon size={15}/> عرض الملف متاح بالرابط объяв выше.</p>:<Empty title="ملف المحاضرة غير مرفوع" description="ارفع الملفات وتاريخ الإصدارات يحتاج خدمة تخزين R2 موثقة."/>}</div></div></>}
