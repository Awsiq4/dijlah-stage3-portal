"use client";

import {useEffect, useState} from "react";
import {BookOpen, ClipboardList, FileQuestion, Megaphone, Pencil, Search, Trash2} from "lucide-react";
import {Empty} from "@/components/UI";

export const CONTENT_SECTIONS = [
  {id: "lectures", label: "المحاضرات والملخصات", addLabel: "محاضرة أو ملخص", Icon: BookOpen},
  {id: "announcements", label: "التبليغات", addLabel: "تبليغ", Icon: Megaphone},
  {id: "assignments", label: "الواجبات والتكاليف", addLabel: "واجب أو تكليف", Icon: ClipboardList},
  {id: "exams", label: "الكويزات", addLabel: "كويز", Icon: FileQuestion},
] as const;

export type PublicationType = typeof CONTENT_SECTIONS[number]["id"];
type Row = Record<string, unknown>;

export function useAdminRows(type: string | null) {
  const [result, setResult] = useState<{type: string; rows: Row[]; failed: boolean} | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!type) return;
    const controller = new AbortController();
    fetch(`/api/admin/content?type=${type}`, {cache: "no-store", signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Content unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setResult({type, rows: data.rows || [], failed: false});
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({type, rows: [], failed: true});
      });
    return () => controller.abort();
  }, [type, version]);
  return {
    rows: result?.type === type ? result.rows : null,
    failed: result?.type === type && result.failed,
    reload: () => setVersion(value => value + 1),
  };
}

export function ContentList({rows, subjects, onEdit, onRemove}: {
  rows: Row[];
  subjects: Row[];
  onEdit: (row: Row) => void;
  onRemove: (row: Row) => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const subjectNames = new Map(subjects.map(item => [String(item.id), String(item.name)]));
  const availableSubjects = [...new Set(rows.map(row => String(row.subject_id || "")).filter(Boolean))];
  const search = query.trim().toLocaleLowerCase("ar");
  const getSections = (row: Row) => Array.isArray(row.sections) ? row.sections.map(String) : row.section ? [String(row.section)] : [];
  const filtered = rows.filter(row => {
    const name = String(row.title || row.name || row.id);
    const sections = getSections(row);
    return (!search || name.toLocaleLowerCase("ar").includes(search))
      && (!subject || row.subject_id === subject)
      && (!section || sections.includes(section) || sections.includes("all") || (!sections.length && ("sections" in row || "scope" in row)));
  });

  return <>
    {rows.length > 0 && <div className="admin-content-filters">
      <label className="search"><Search size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="بحث بالعنوان" placeholder="ابحث بالعنوان"/></label>
      {availableSubjects.length > 0 && <select aria-label="تصفية حسب المادة" value={subject} onChange={event => setSubject(event.target.value)}>
        <option value="">كل المواد</option>
        {availableSubjects.map(id => <option key={id} value={id}>{subjectNames.get(id) || id}</option>)}
      </select>}
      {rows.some(row => getSections(row).length > 0 || "sections" in row) && <select aria-label="تصفية حسب الشعبة" value={section} onChange={event => setSection(event.target.value)}>
        <option value="">كل الشعب</option>
        {["A", "B", "C", "F"].map(value => <option key={value} value={value}>{value}</option>)}
      </select>}
    </div>}
    {filtered.length ? <div className="stack">{filtered.map(row => {
      const name = String(row.title || row.name || row.id);
      const subjectName = subjectNames.get(String(row.subject_id)) || String(row.subject_id || "");
      const sections = getSections(row);
      const details = [subjectName, sections.includes("all") || sections.length === 4 ? "كل الشعب" : sections.join("، ")].filter(Boolean);
      return <div className="list-row admin-content-row" key={String(row.id)}>
        <div className="grow"><strong>{name}</strong>{details.length > 0 && <p className="subtle small">{details.join(" · ")}</p>}</div>
        <button type="button" className="action-button secondary" aria-label={`تعديل ${name}`} onClick={() => onEdit(row)}><Pencil size={16}/></button>
        <button type="button" className="action-button secondary" aria-label={`حذف ${name}`} onClick={() => onRemove(row)}><Trash2 size={16}/></button>
      </div>;
    })}</div> : <Empty title={rows.length ? "ماكو نتائج مطابقة" : "ماكو محتوى بهالقسم"} description={rows.length ? "جرّب تغيير البحث أو الفلاتر." : ""}/>}
  </>;
}
