"use client";

import {useEffect, useState} from "react";
import type {LucideIcon} from "lucide-react";
import {BookOpen, ClipboardList, FileQuestion, Megaphone, Pencil, Search, Trash2} from "lucide-react";
import {Empty, Status} from "@/components/UI";

export const CONTENT_SECTIONS = [
  {id: "lectures", label: "المحاضرات والملخصات", addLabel: "محاضرة أو ملخص", Icon: BookOpen},
  {id: "announcements", label: "التبليغات", addLabel: "تبليغ", Icon: Megaphone},
  {id: "assignments", label: "الواجبات والتكاليف", addLabel: "واجب أو تكليف", Icon: ClipboardList},
  {id: "exams", label: "الكويزات", addLabel: "كويز", Icon: FileQuestion},
] as const;

export type PublicationType = typeof CONTENT_SECTIONS[number]["id"];
type Row = Record<string, unknown>;

export function AdminNavGroup<T extends string>({label, items, active, onSelect}: {
  label?: string;
  items: readonly {id: T; label: string; Icon: LucideIcon}[];
  active: string;
  onSelect: (id: T) => void;
}) {
  return <div className="admin-side-group">
    {label && <p>{label}</p>}
    {items.map(({id, label: name, Icon}) =>
      <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => onSelect(id)}>
        <Icon size={17}/><span>{name}</span>
      </button>
    )}
  </div>;
}

const STATUS_LABELS: Record<string, string> = {
  published: "منشور", draft: "مسودة", active: "نشط", closed: "منتهٍ", cancelled: "ملغى",
  confirmed: "مؤكد", provisional: "مبدئي", normal: "اعتيادي", moved: "منقول", extra: "إضافي",
};
const dateFormat = new Intl.DateTimeFormat("ar-IQ", {dateStyle: "medium", timeZone: "Asia/Baghdad"});

function rowDate(row: Row) {
  const date = new Date(String(row.due_at || row.date || row.published_at || row.created_at || ""));
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

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

export function ContentList({rows, subjects, selected, onEdit, onRemove}: {
  rows: Row[];
  subjects: Row[];
  selected?: string;
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
    {filtered.length ? <div className="admin-table-wrap"><table className="admin-content-table">
      <thead><tr><th scope="col">العنوان</th><th scope="col">المادة</th><th scope="col">الشعبة</th><th scope="col">التاريخ</th><th scope="col">الحالة</th><th scope="col">الإجراءات</th></tr></thead>
      <tbody>{filtered.map(row => {
        const name = String(row.title || row.name || row.id);
        const subjectName = subjectNames.get(String(row.subject_id)) || String(row.subject_id || "");
        const sections = getSections(row);
        const sectionName = sections.includes("all") || sections.length === 4 || (Array.isArray(row.sections) && !sections.length) ? "كل الشعب" : sections.join("، ");
        const details = [subjectName, sectionName].filter(Boolean).join(" · ");
        const status = row.archived_at ? "مؤرشف" : STATUS_LABELS[String(row.status)];
        return <tr key={String(row.id)} className={selected === String(row.id) ? "admin-row-selected" : undefined}>
          <td className="admin-table-title"><strong>{name}</strong>{details && <p className="subtle small admin-mobile-detail">{details}</p>}</td>
          <td className="admin-table-meta">{subjectName || "—"}</td>
          <td className="admin-table-meta">{sectionName || "—"}</td>
          <td className="admin-table-meta">{rowDate(row)}</td>
          <td className="admin-table-meta">{status ? <Status>{status}</Status> : "—"}</td>
          <td className="admin-table-actions"><div>
            <button type="button" className="action-button secondary" aria-label={`تعديل ${name}`} title="تعديل" onClick={() => onEdit(row)}><Pencil size={16}/></button>
            <button type="button" className="action-button secondary" aria-label={`حذف ${name}`} title="حذف" onClick={() => onRemove(row)}><Trash2 size={16}/></button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div> : <Empty title={rows.length ? "ماكو نتائج مطابقة" : "ماكو محتوى بهالقسم"} description={rows.length ? "جرّب تغيير البحث أو الفلاتر." : ""}/>}
  </>;
}
