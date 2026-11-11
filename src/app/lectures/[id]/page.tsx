"use client";
import {safeFileUrl} from "@/lib/safe-url";
import Link from "next/link";
import {useParams} from "next/navigation";
import {Download, ExternalLink as ExternalLinkIcon} from "lucide-react";
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
  const safeUrl = safeFileUrl(lecture.fileUrl);
  const pdf = /\.pdf(?:$|[?#])/i.test(lecture.fileUrl) || /\.pdf$/i.test(lecture.fileName || "");
  const pptx = /\.pptx(?:$|[?#])/i.test(lecture.fileUrl) || /\.pptx$/i.test(lecture.fileName || "");
  return <>
    <Link className="back-link" href={`/subjects/${lecture.subjectId}`}>{subject?.name} ←</Link>
    <PageHeading title={lecture.title} description={`${summary ? "ملخص" : "المحاضرة " + lecture.number} · آخر تحديث ${formatDate(lecture.updatedAt)}`}/>
    <div className="panel"><div className="panel-body">
      {lecture.description && <p>{lecture.description}</p>}
      {safeUrl && pdf ? <PdfViewer src={safeUrl} fileName={lecture.fileName}/> : safeUrl && pptx ?
        <div className="pdf-state">
          <p>📊 عرض PowerPoint — {lecture.fileName || "المحاضرة.pptx"}</p>
          <p>حمّل العرض وافتحه في PowerPoint أو تطبيق عروض تقديمية متوافق.</p>
          <a className="action-button" href={safeUrl} target="_blank" rel="noopener noreferrer" download={lecture.fileName || true}><Download size={16}/> تنزيل PowerPoint (.pptx)</a>
        </div> : safeUrl ?
        <a className="action-button" target="_blank" rel="noopener noreferrer" href={safeUrl}><ExternalLinkIcon size={16}/> فتح الملف</a>
        : <Empty title="الملف غير مرفوع بعد"/>}
    </div></div>
  </>;
}
