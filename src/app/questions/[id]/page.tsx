"use client";

import Link from "next/link";
import {useParams} from "next/navigation";
import {Download, FileImage, FileText, ExternalLink} from "lucide-react";
import {usePortal} from "@/lib/storage";
import {safeFileUrl} from "@/lib/safe-url";
import PdfViewer from "@/components/PdfViewer";
import {Empty, PageHeading} from "@/components/UI";
import {formatDate, getSubject} from "@/lib/seed";

// Reuse the same in-portal PDF reader as lectures. Published questions
// are already filtered by section and archived state in the public API.
export default function PastQuestionPage() {
  const {id} = useParams<{id: string}>();
  const {data, section, reloadContent} = usePortal();
  const question = data.questions.find(item => item.id === id && item.sections.includes(section));
  if (!question) return <div className="stack">
    <Empty title="ملف الأسئلة غير متاح لهذه الشعبة" description="تأكد من الشعبة المختارة، أو حدّث البيانات. قد يكون الملف محذوفاً أو مؤرشفاً."/>
    <div className="row-actions">
      <button type="button" className="action-button" onClick={reloadContent}>تحديث البيانات</button>
      <Link href="/subjects" className="action-button secondary">العودة إلى المواد</Link>
    </div>
  </div>;

  const subject = getSubject(data, question.subjectId);
  const url = safeFileUrl(question.fileUrl);
  const name = question.fileName || question.title;
  const pdf = /\.pdf(?:$|[?#])/i.test(url) || /\.pdf$/i.test(name);
  const image = /\.(?:png|jpe?g)(?:$|[?#])/i.test(url) || /\.(?:png|jpe?g)$/i.test(name);
  const powerpoint = /\.pptx?(?:$|[?#])/i.test(url) || /\.pptx?$/i.test(name);
  const kind = question.examKind === "quiz" ? "امتحان يومي" : question.examKind === "midterm" ? "Midterm" : "Final";

  return <>
    <Link className="back-link" href={`/subjects/${encodeURIComponent(question.subjectId)}?tab=questions&section=${section}`}>
      {subject?.name || "المادة"} — أسئلة الامتحانات السابقة
    </Link>
    <PageHeading title={question.title} description={`${subject?.name || ""} · ${kind}${question.academicYear ? " · " + question.academicYear : ""} · ${formatDate(question.createdAt)}`}/>
    <div className="panel"><div className="panel-body">
      {url && pdf ? <PdfViewer src={url} fileName={name}/> :
        url && image ? <div className="stack">
          <div className="pdf-toolbar"><FileImage size={20}/><strong>صورة أسئلة الامتحان</strong>
            <a className="action-button" href={url} target="_blank" rel="noopener noreferrer" download={name}><Download size={16}/> حفظ الصورة</a>
          </div>
          <img src={url} alt={`أسئلة ${question.title}`} loading="lazy" decoding="async" style={{display:"block",maxWidth:"100%",height:"auto",margin:"auto",borderRadius:12}}/>
        </div> :
        url && powerpoint ? <div className="pdf-state">
          <FileText size={28}/><p>هذا الملف عرض PowerPoint. يمكن تحميله وفتحه بتطبيق عروض تقديمية.</p>
          <a className="action-button" href={url} target="_blank" rel="noopener noreferrer" download={name}><Download size={16}/> تحميل PowerPoint</a>
        </div> :
        url ? <div className="pdf-state">
          <a className="action-button" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> فتح الملف</a>
        </div> :
        <Empty title="الملف غير متاح حالياً"/>}
    </div></div>
  </>;
}
