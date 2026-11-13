"use client";

import Link from "next/link";
import {useEffect, useState} from "react";
import {ArrowUpLeft, CalendarDays} from "lucide-react";
import {Empty, PageHeading, Status} from "@/components/UI";
import {usePortal} from "@/lib/storage";
import {getSubject} from "@/lib/seed";
import {studentWeek} from "@/lib/student-week";

const LABELS = {assignment: "واجب", quiz: "كويز", schedule: "الجدول"};
const STATUS: Record<string, string> = {
  cancelled: "ملغى", moved: "موعد منقول", extra: "محاضرة إضافية",
  provisional: "مبدئي", confirmed: "مؤكد", closed: "منتهٍ",
};
const formatDay = new Intl.DateTimeFormat("ar-IQ", {weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Baghdad"});
const formatDate = new Intl.DateTimeFormat("ar-IQ", {day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Baghdad"});
const asDate = (day: string) => new Date(day + "T12:00:00Z");

export default function ThisWeek() {
  const {data, section, hydrated} = usePortal();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now || !hydrated) return <PageHeading title="هذا الأسبوع" description="جارٍ تجهيز المواعيد…"/>;
  // Shared provider has already loaded the authoritative section snapshot.
  // Avoid an extra request to /api/public/content?type=week per visit.
  const week = studentWeek(data, section, now);

  return <>
    <PageHeading title="هذا الأسبوع" description={`شعبة ${section} · ${formatDate.format(asDate(week.dates[0]))} – ${formatDate.format(asDate(week.dates[6]))}`}/>
    {!week.items.length && <Empty title="لا توجد مواعيد لهذا الأسبوع" description="تظهر الواجبات والكويزات وتغييرات الجدول هنا عند إضافتها لشعبتك."/>}
    <div className="stack student-week">
      {week.dates.map(date => {
        const items = week.items.filter(item => item.date === date);
        const today = date === week.today;
        if (!items.length && !today) return null;
        return <section key={date} className="panel">
          <div className="panel-heading">
            <h2><CalendarDays size={18}/> {formatDay.format(asDate(date))}</h2>
            {today && <Status tone="info">اليوم</Status>}
          </div>
          <div className="panel-body">
            {!items.length && <p className="subtle small">لا توجد مواعيد اليوم.</p>}
            {items.map(item => <Link className="list-row student-week-link" key={item.kind + item.id} href={item.href}>
              <div className="grow">
                <strong>{item.title}</strong>
                <p className="subtle small">{LABELS[item.kind]}{item.subjectId && " · " + (getSubject(data, item.subjectId)?.name || item.subjectId)}{item.time && <> · <bdi>{item.time}</bdi></>}</p>
              </div>
              {STATUS[item.status] && <Status tone={item.status === "cancelled" ? "danger" : item.status === "moved" ? "warning" : "muted"}>{STATUS[item.status]}</Status>}
              <ArrowUpLeft size={16} aria-hidden/>
            </Link>)}
          </div>
        </section>;
      })}
    </div>
  </>;
}
