"use client";

import {useEffect, useState} from "react";
import type {LucideIcon} from "lucide-react";
import {BookOpen, ClipboardList, FileQuestion, Megaphone, Pencil, Search, Trash2, ChevronLeft, ChevronRight, ArrowDown, ArrowUp} from "lucide-react";
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

const PAGE_SIZE = 20;
const DATE_FIELDS: Record<string, {field: string; label: string}> = {
  lectures: {field: "created_at", label: "تاريخ الإضافة"},
  announcements: {field: "published_at", label: "تاريخ النشر"},
  assignments: {field: "due_at", label: "آخر يوم للتسليم"},
  exams: {field: "date", label: "موعد الكويز"},
  examSchedule: {field: "date", label: "موعد الامتحان"},
};

function rowDate(row: Row, field: string) {
  return Date.parse(String(row[field] || ""));
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

export function ContentList({kind, rows, subjects, selected, onEdit, onRemove}: {
  kind: string;
  rows: Row[];
  subjects: Row[];
  selected?: string;
  onEdit: (row: Row) => void;
  onRemove: (row: Row) => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [page, setPage] = useState(1);
  const [ascending, setAscending] = useState(false);
  const date = DATE_FIELDS[kind];
  const hasFilters = Boolean(query || subject || section);
  function clearFilters() {
    setQuery("");
    setSubject("");
    setSection("");
    setPage(1);
  }
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

  if (date) filtered.sort((a, b) => {
    const first = rowDate(a, date.field);
    const second = rowDate(b, date.field);
    if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
    if (!Number.isFinite(second)) return -1;
    return ascending ? first - second : second - first;
  });
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const showSubject = availableSubjects.length > 0;
  const showSection = rows.some(row => getSections(row).length > 0 || "sections" in row);
  const showStatus = rows.some(row => row.status || row.archived_at);

  return <>
    {rows.length > 0 && <div className="admin-content-filters">
      <label className="search"><Search size={16}/><input type="search" value={query} onChange={event => {setQuery(event.target.value); setPage(1);}} aria-label="بحث بالعنوان" placeholder="ابحث بالعنوان"/></label>
      {showSubject && <select aria-label="تصفية حسب المادة" value={subject} onChange={event => {setSubject(event.target.value); setPage(1);}}>
        <option value="">كل المواد</option>
        {availableSubjects.map(id => <option key={id} value={id}>{subjectNames.get(id) || id}</option>)}
      </select>}
      {showSection && <select aria-label="تصفية حسب الشعبة" value={section} onChange={event => {setSection(event.target.value); setPage(1);}}>
        <option value="">كل الشعب</option>
        {["A", "B", "C", "F"].map(value => <option key={value} value={value}>{value}</option>)}
      </select>}
    </div>}
    {rows.length > 0 && <div className="admin-list-summary">
      <span role="status">{filtered.length} نتيجة{filtered.length !== rows.length ? " من " + rows.length : ""}</span>
      {hasFilters && <button type="button" className="admin-reset-filters" onClick={clearFilters}>مسح الفلاتر</button>}
    </div>}
    {filtered.length ? <div className="admin-table-wrap"><table className="admin-content-table">
      <thead><tr>
        <th scope="col">{kind === "subjects" ? "المادة" : "العنوان"}</th>
        {showSubject && <th scope="col">المادة</th>}
        {showSection && <th scope="col">الشعبة</th>}
        {date && <th scope="col" aria-sort={ascending ? "ascending" : "descending"}>
          <button type="button" className="admin-date-sort" onClick={() => {setAscending(value => !value); setPage(1);}}>
            {date.label}{ascending ? <ArrowUp size={13}/> : <ArrowDown size={13}/>}
          </button>
        </th>}
        {showStatus && <th scope="col">الحالة</th>}
        <th scope="col">الإجراءات</th>
      </tr></thead>
      <tbody>{visible.map(row => {
        const name = String(row.title || row.name || row.id);
        const subjectName = subjectNames.get(String(row.subject_id)) || String(row.subject_id || "");
        const sections = getSections(row);
        const sectionName = sections.includes("all") || sections.length === 4 || (Array.isArray(row.sections) && !sections.length) ? "كل الشعب" : sections.join("، ");
        const details = [subjectName, sectionName].filter(Boolean).join(" · ");
        const status = row.archived_at ? "مؤرشف" : STATUS_LABELS[String(row.status)];
        return <tr key={String(row.id)} className={selected === String(row.id) ? "admin-row-selected" : undefined}>
          <td className="admin-table-title"><strong>{name}</strong>{details && <p className="subtle small admin-mobile-detail">{details}</p>}</td>
          {showSubject && <td className="admin-table-meta">{subjectName || "—"}</td>}
          {showSection && <td className="admin-table-meta">{sectionName || "—"}</td>}
          {date && <td className="admin-table-meta admin-date-cell">{Number.isFinite(rowDate(row, date.field)) ? dateFormat.format(rowDate(row, date.field)) : "—"}</td>}
          {showStatus && <td className="admin-table-meta admin-status-cell">{status ? <Status tone={["published", "active", "confirmed"].includes(String(row.status)) && !row.archived_at ? "success" : "muted"}>{status}</Status> : "—"}</td>}
          <td className="admin-table-actions"><div>
            <button type="button" className="action-button secondary" aria-label={`تعديل ${name}`} title="تعديل" onClick={() => onEdit(row)}><Pencil size={16}/><span className="admin-edit-label">تعديل</span></button>
            <button type="button" className="action-button secondary" aria-label={`حذف ${name}`} title="حذف" onClick={() => onRemove(row)}><Trash2 size={16}/></button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div> : <Empty title={rows.length ? "ماكو نتائج مطابقة" : "ماكو محتوى بهالقسم"} description={rows.length ? "جرّب تغيير البحث أو الفلاتر." : ""}/>}
    {lastPage > 1 && <nav className="admin-pagination" aria-label="صفحات المحتوى">
      <button type="button" className="action-button secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronRight size={16}/> السابق</button>
      <span>صفحة {currentPage} من {lastPage}</span>
      <button type="button" className="action-button secondary" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>التالي <ChevronLeft size={16}/></button>
    </nav>}
  </>;
}
