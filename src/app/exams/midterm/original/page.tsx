import {statSync} from "node:fs";
import {join} from "node:path";
import Link from "next/link";
import PdfViewer from "@/components/PdfViewer";
import {Empty, PageHeading} from "@/components/UI";

const fileName = "جدول المد.pdf";
const filePath = "/exam-schedules/midterms-2026-2027.pdf";

export default function OriginalMidtermSchedule() {
  const hasOriginal = statSync(join(process.cwd(), "public", filePath), {throwIfNoEntry: false})?.isFile();

  return <>
    <Link className="back-link" href="/exams?tab=midterms">العودة إلى جدول امتحانات المد</Link>
    <PageHeading title="الجدول الأصلي لامتحانات المد" description="الفصل الأول · السنة الدراسية ٢٠٢٦–٢٠٢٧"/>
    <div className="panel">
      <div className="panel-body">
        {hasOriginal ? <PdfViewer src={filePath} fileName={fileName}/> :
          <Empty title="ملف الجدول الأصلي غير متاح حاليًا" description="يمكنك مراجعة المواعيد المنشورة في جدول امتحانات المد."/>}
      </div>
    </div>
  </>;
}
