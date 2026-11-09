"use client";
import Link from "next/link";
import {useParams} from "next/navigation";
import {ExternalLink as ExternalLinkIcon} from "lucide-react";
import {usePortal} from "@/lib/storage";
import PdfViewer from "@/components/PdfViewer";
import {Empty,PageHeading} from "@/components/UI";
import {formatDate,getSubject} from "@/lib/seed";
export default function Lecture() {
  const {id} = useParams<{id: string}>();
  const {data} = usePortal();
  const summary = data.summaries?.find(item => item.id === id && item.status === "published");
  const lecture = summary || data.lectures.find(item => item.id === id && item.status === "published");
  if (!lecture) return <Empty title="المحاضرة أو الملخص غير موجود"/>;
  const subject = getSubject(data, lecture.subjectId);
  const safeUrl = /^https:\/\//.test(lecture.fileUrl) || /^\/(?![\/\\])/.test(lecture.fileUrl);
  const pdf = /\.pdf(?:$|[?#])/i.test(lecture.fileUrl) || /\.pdf$/i.test(lecture.fileName || "");
  return <>
    <Link className="back-link" href={`/subjects/${lecture.subjectId}`}>{subject?.name} ←</Link>
    <PageHeading title={lecture.title} description={`${summary ? "ملخص" : "المحاضرة " + lecture.number} · آخر تحديث ${formatDate(lecture.updatedAt)}`}/>
    <div className="panel"><div className="panel-body">
      {lecture.description && <p>{lecture.description}</p>}
      {safeUrl && pdf ? <PdfViewer src={lecture.fileUrl} fileName={lecture.fileName}/> : safeUrl ?
        <a className="action-button" target="_blank" rel="noopener noreferrer" href={lecture.fileUrl}><ExternalLinkIcon size={16}/> فتح الملف</a>
        : <Empty title="الملف غير مرفوع بعد"/>}
    </div></div>
  </>;
}
