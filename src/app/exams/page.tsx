"use client";

import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {Suspense} from "react";
import {FileText} from "lucide-react";
import {Empty, PageHeading, Status} from "@/components/UI";
import {formatDate, getSubject, SECTIONS} from "@/lib/seed";
import {usePortal} from "@/lib/storage";
import {useDetailAnchor} from "@/lib/use-detail-anchor";
import {useBaghdadDay} from "@/lib/use-baghdad-day";
import {
  formatMidtermDate,
  formatMidtermTime,
  getClosestMidterm,
  getFirstSemesterMidterms,
  isFirstSemesterMidterm,
  MIDTERM_ACADEMIC_YEAR,
  MIDTERM_PATH,
  MIDTERM_TITLE,
  midtermSubjectLabel,
} from "@/lib/midterms";
import type {Exam, PortalData} from "@/lib/types";
import styles from "./exams.module.css";

const DAILY_QUIZ = "كوز يومي";

function ExamCards({exams, data}: {exams: Exam[]; data: PortalData}) {
  return <div className="stack">{exams.map(exam => (
    <article className="panel exam-card" key={exam.id} id={"exam-" + exam.id}>
      <div className="panel-heading">
        <div>
          <strong>{exam.title}</strong>
          <p className="subtle small">{getSubject(data, exam.subjectId)?.name} · {exam.type}</p>
        </div>
        <Status tone={exam.status === "confirmed" ? "success" : exam.status === "cancelled" ? "danger" : "warning"}>
          {exam.status === "confirmed" ? "مؤكد" : exam.status === "cancelled" ? "ملغى" : "غير نهائي"}
        </Status>
      </div>
      <div className="panel-body">
        <div className="kv"><span>التاريخ</span><strong>{formatDate(exam.date)}</strong></div>
        {exam.type !== DAILY_QUIZ && <div className="kv"><span>الوقت</span><strong>{exam.startTime || "غير محدد"}</strong></div>}
        <div className="kv"><span>القاعة</span><strong>{exam.room || "غير محددة"}</strong></div>
        {exam.topics && <p><strong>المواد الداخلة:</strong> {exam.topics}</p>}
        {exam.notes && <p>{exam.notes}</p>}
      </div>
    </article>
  ))}</div>;
}

function MidtermSchedule({exams, data}: {exams: Exam[]; data: PortalData}) {
  const today = useBaghdadDay();
  const closest = getClosestMidterm(exams, today);
  const firstTime = exams[0]?.startTime;
  const commonTime = firstTime && exams.every(exam => exam.startTime === firstTime) ? firstTime : "";
  const allSections = exams.length > 0 && exams.every(exam => SECTIONS.every(section => exam.sections.includes(section)));
  const showRooms = exams.some(exam => exam.room);
  const summary = [commonTime && formatMidtermTime(commonTime), allSections && "جميع الشعب"].filter(Boolean).join(" · ");

  return <section className="panel" aria-labelledby="midterm-schedule-title" dir="rtl">
    <div className="panel-heading">
      <div>
        <h2 id="midterm-schedule-title">{MIDTERM_TITLE}</h2>
        <p className="subtle small">{MIDTERM_ACADEMIC_YEAR}</p>
        {summary && <p className={styles.summary}>{summary}</p>}
      </div>
    </div>
    {exams.length ? <table className={styles.schedule} role="table" aria-labelledby="midterm-schedule-title">
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col">اليوم والتاريخ{commonTime ? "" : " والوقت"}</th>
          <th role="columnheader" scope="col">المادة</th>
          {showRooms && <th role="columnheader" scope="col">القاعة</th>}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {exams.map(exam => {
          const nearest = exam.id === closest?.id;
          const subject = getSubject(data, exam.subjectId);
          const subjectLabel = midtermSubjectLabel(exam, subject?.name);

          return <tr
            className={nearest ? styles.nearest : undefined}
            id={"exam-" + exam.id}
            key={exam.id}
            role="row"
          >
            <td className={styles.date} role="cell">
              <time dateTime={exam.date}>{formatMidtermDate(exam.date)}</time>
              {!commonTime && <span>{formatMidtermTime(exam.startTime)}</span>}
              {exam.scheduleUpdatedAt && <Status>تم تحديث الموعد</Status>}
            </td>
            <td className={styles.subject} role="cell">
              <Link href={`/subjects/${encodeURIComponent(exam.subjectId)}?tab=exams`}>
                {subjectLabel}
              </Link>
              {!allSections && <span className="small subtle">الشعب <bdi>{exam.sections.join(" · ")}</bdi></span>}
              {nearest && <Status tone="info">أقرب امتحان</Status>}
              {exam.status === "cancelled" && <Status tone="danger">ملغى</Status>}
              {exam.status === "provisional" && <Status tone="warning">غير نهائي</Status>}
            </td>
            {showRooms && <td className={styles.room} role="cell">
              {exam.room && <><span className={styles.mobileRoomLabel}>القاعة </span>{exam.room}</>}
            </td>}
          </tr>;
        })}
      </tbody>
    </table> : <Empty title="ماكو امتحانات مد منشورة حالياً" description="راح تظهر مواعيد امتحانات المد عند نشرها لشعبتك."/>}
    <div className={styles.footer}>
      <Link className="action-button secondary" href="/exams/midterm/original">
        <FileText size={16} aria-hidden="true"/> عرض الجدول الأصلي
      </Link>
    </div>
  </section>;
}

function ExamsContent() {
  const {data, section} = usePortal();
  const midtermsTab = useSearchParams().get("tab") === "midterms";
  useDetailAnchor(data.exams, undefined, midtermsTab ? "midterms" : "quizzes");
  const otherExams = data.exams
    .filter(exam => exam.sections.includes(section) && !isFirstSemesterMidterm(exam))
    .sort((a, b) => a.date.localeCompare(b.date));

  return <>
    <PageHeading title="الامتحانات والكويزات" description={`مواعيد وتفاصيل امتحانات الشعبة ${section}`}/>
    <nav className={`tabs ${styles.navigation}`} aria-label="أقسام الامتحانات">
      <Link className={`tab-link ${styles.tab}`} href="/exams" scroll={false} aria-current={!midtermsTab ? "page" : undefined}>
        الكويزات
      </Link>
      <Link className={`tab-link ${styles.tab}`} href={MIDTERM_PATH} scroll={false} aria-current={midtermsTab ? "page" : undefined}>
        امتحانات المد
      </Link>
    </nav>
    {midtermsTab
      ? <MidtermSchedule data={data} exams={getFirstSemesterMidterms(data.exams, section)}/>
      : otherExams.length
        ? <ExamCards exams={otherExams} data={data}/>
        : <Empty title="ماكو كوزات أو امتحانات منشورة حالياً" description="راح تظهر مواعيد الكوزات وجداول الامتحانات لشعبتك عند إعلانها."/>
    }
  </>;
}

export default function Exams() {
  return <Suspense fallback={<PageHeading title="الامتحانات والكويزات"/>}>
    <ExamsContent/>
  </Suspense>;
}
