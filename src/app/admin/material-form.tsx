"use client";

import {useEffect, useRef, useState} from "react";
import {upload} from "@vercel/blob/client";
import {usePublicationRequest} from "./publication-review";
import {Send} from "lucide-react";

type Row = Record<string, unknown>;
export type PublishingAccount = {
  id?: number;
  role?: string;
  assigned_section?: string | null;
  assigned_subjects?: string[] | null;
  perms?: {teacher_sections?: Record<string, string[]>};
};

const SECTIONS = ["A", "B", "C", "F"];
const PDF_LIMIT = 100 * 1024 * 1024;

export function MaterialForm({account, initial, rows, onSaved}: {
  account: PublishingAccount;
  initial?: Row;
  rows: Row[];
  onSaved: () => void;
}) {
  const {request, review} = usePublicationRequest();
  const teacher = account.role === "teacher";
  const sectionRep = account.role === "section_representative";
  const [subjects, setSubjects] = useState<{id: string; name: string}[]>([]);
  const [subject, setSubject] = useState(String(initial?.subject_id || (teacher && account.assigned_subjects?.length === 1 ? account.assigned_subjects[0] : "")));
  const [kind, setKind] = useState(initial?.material_kind === "summary" ? "summary" : "lecture");
  const [title, setTitle] = useState(String(initial?.title || ""));
  const [description, setDescription] = useState(String(initial?.description || ""));
  const [number, setNumber] = useState(initial?.number ? String(initial.number) : "");
  const [audience, setAudience] = useState(Array.isArray(initial?.sections) ? initial.sections.join(",") : sectionRep && account.assigned_section ? account.assigned_section : "");
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const uploadCache = useRef<{file: File; subject: string; audience: string; url: string} | null>(null);
  const draftId = useRef("");
  const lock = useRef(false);
  const busy = status !== "idle";

  useEffect(() => {
    let active = true;
    fetch("/api/public/content?type=subjects", {cache: "no-store"})
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (active) setSubjects((data.content?.subjects || []).map((row: Row) => ({id: String(row.id), name: String(row.name)})));
      })
      .catch(() => { if (active) setNotice("تعذّر تحميل المواد. حدّث الصفحة وحاول مرة ثانية."); });
    return () => { active = false; };
  }, []);

  const subjectOptions = teacher ? subjects.filter(item => account.assigned_subjects?.includes(item.id)) : subjects;
  const allowed = teacher ? SECTIONS.filter(section => (account.perms?.teacher_sections?.[subject] ?? SECTIONS).includes(section)) : SECTIONS;
  const choices = [{value: allowed.join(","), label: teacher && allowed.length !== 4 ? "الشعب المسموح بها" : "كل الشعب"}];
  const singleSections = sectionRep ? SECTIONS.filter(section => section === account.assigned_section) : allowed;
  if (allowed.length > 1) choices.push(...singleSections.map(section => ({value: section, label: sectionRep ? `شعبتي (${section})` : `شعبة ${section}`})));
  if (initial && audience && !choices.some(choice => choice.value === audience)) choices.push({value: audience, label: `الشعب الحالية (${audience})`});
  const selection = choices.some(choice => choice.value === audience) ? audience : choices[0].value;
  const sections = selection.split(",").filter(Boolean);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setNotice("");
    setLink("");
    if (!subjectOptions.some(item => item.id === subject) || !sections.length) { setNotice("اختر مادة وشعبة متاحة للنشر."); return; }
    if (!title.trim()) { setNotice("اكتب عنوان الملف."); return; }
    if (!file && !initial?.file_url) { setNotice("اختر ملف PDF من جهازك."); return; }
    lock.current = true;
    let saving = false;
    try {
      let fileUrl = String(initial?.file_url || "");
      if (file) {
        const header = await file.slice(0, 5).text();
        if (!file.size || file.size > PDF_LIMIT || !/\.pdf$/i.test(file.name) || header !== "%PDF-") {
          setNotice("اختر ملف PDF صالحًا بحجم لا يتجاوز 100 ميغابايت.");
          return;
        }
        const cached = uploadCache.current;
        if (cached?.file === file && cached.subject === subject && cached.audience === selection) {
          fileUrl = cached.url;
        } else {
          setStatus("uploading");
          setProgress(0);
          const basename = file.name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "document";
          const pathname = `lectures/${crypto.randomUUID()}-${basename}.pdf`;
          const blob = await upload(pathname, file, {
            access: "public",
            contentType: "application/pdf",
            handleUploadUrl: "/api/admin/upload",
            headers: {"x-portal-admin": "1"},
            multipart: file.size > 5 * 1024 * 1024,
            clientPayload: JSON.stringify({filename: file.name, contentType: "application/pdf", size: file.size, subjectId: subject, sections}),
            onUploadProgress: ({percentage}) => setProgress(Math.round(percentage)),
          });
          fileUrl = blob.url;
          uploadCache.current = {file, subject, audience: selection, url: fileUrl};
        }
      }
      saving = true;
      setStatus("saving");
      if (!draftId.current) draftId.current = String(initial?.id || `web-${crypto.randomUUID()}`);
      const nextNumber = 1 + rows.reduce((max, row) => row.subject_id === subject && row.material_kind !== "summary" ? Math.max(max, Number(row.number) || 0) : max, 0);
      const row = {
        id: draftId.current, subject_id: subject, material_kind: kind,
        number: kind === "summary" ? 1 : Number(number) || nextNumber,
        title: title.trim(), description: description.trim(), file_url: fileUrl,
        file_name: file?.name || String(initial?.file_name || ""), sections,
        status: initial?.status || "published", updated_at: new Date().toISOString().slice(0, 10),
      };
      const {response, data} = await request("lectures", row);
      if (!response.ok) {
        setNotice(data.issue ? data.error || "" : response.status === 401 ? "انتهت جلسة الدخول. سجّل الدخول مجددًا." : response.status === 403 ? "حسابك لا يملك صلاحية النشر لهذه المادة أو الشعبة." : data.error || "تعذّر حفظ المنشور. جرّب مرة ثانية من نفس الشاشة.");
        return;
      }
      setNotice(data.action === "expanded" ? "تم نشر الملف للشعب الإضافية." : data.action === "updated" || initial ? "تم حفظ التعديلات." : "تم نشر الملف.");
      if (row.status === "published" && !initial?.archived_at) setLink(data.url || `/lectures/${encodeURIComponent(data.id || row.id)}?section=${encodeURIComponent(sections[0])}`);
      if (!initial) {
        setFile(undefined);
        setTitle("");
        setDescription("");
        setNumber("");
        draftId.current = "";
        uploadCache.current = null;
        if (input.current) input.current.value = "";
      }
      onSaved();
    } catch {
      setNotice(saving ? "تعذّر الاتصال أثناء الحفظ. جرّب مرة ثانية من نفس الشاشة." : "تعذّر رفع الملف. تأكد من الاتصال وحاول مجددًا. بياناتك باقية في النموذج.");
    } finally {
      lock.current = false;
      setStatus("idle");
    }
  }

  return <>{review}<form className="admin-form" onSubmit={save} aria-busy={busy}>
    <label className="form-field"><span>المادة</span>
      <select required value={subject} disabled={busy} onChange={e => setSubject(e.target.value)}>
        <option value="">اختر المادة</option>
        {subjectOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label className="form-field"><span>نوع الملف</span>
      <select value={kind} disabled={busy} onChange={e => setKind(e.target.value)}>
        <option value="lecture">محاضرة / ملزمة</option>
        <option value="summary">ملخص</option>
      </select>
    </label>
    <label className="form-field wide"><span>ملف PDF {initial?.file_url ? "جديد (اختياري)" : "من جهازك"}</span>
      <input ref={input} type="file" accept="application/pdf,.pdf" required={!initial?.file_url} disabled={busy} onChange={e => {
        const selected = e.target.files?.[0];
        setFile(selected);
        setNotice("");
        if (selected && !title.trim()) setTitle(selected.name.replace(/\.pdf$/i, ""));
      }}/>
      <small className="subtle">حتى 100 ميغابايت. ينرفع الملف عند الحفظ.</small>
    </label>
    <label className="form-field wide"><span>العنوان</span><input required value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label>
    <label className="form-field"><span>يظهر إلى</span>
      <select value={selection} disabled={busy || choices.length === 1} onChange={e => setAudience(e.target.value)}>
        {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </label>
    <details className="form-field wide"><summary>تفاصيل اختيارية</summary>
      <label className="form-field"><span>الوصف</span><textarea rows={3} value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></label>
      {kind === "lecture" && <label className="form-field"><span>رقم المحاضرة</span><input type="number" min={1} value={number} placeholder="يتحدد تلقائيًا" disabled={busy} onChange={e => setNumber(e.target.value)}/></label>}
    </details>
    {status === "uploading" && <label className="form-field wide"><span>جارٍ الرفع… {progress}٪</span><progress max={100} value={progress}/></label>}
    {notice && <p className="note form-field wide" role="status">{notice} {link && <a className="text-link" href={link}>عرض الملف على الموقع</a>}</p>}
    <button className="action-button" disabled={busy || !subjectOptions.length}><Send size={16}/> {status === "uploading" ? "جارٍ الرفع…" : status === "saving" ? "جارٍ الحفظ…" : initial ? "حفظ التعديلات" : "نشر الملف"}</button>
  </form></>;
}
