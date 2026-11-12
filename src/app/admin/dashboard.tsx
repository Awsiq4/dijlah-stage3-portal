"use client";
import React,{useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {BellRing,BookOpen,CalendarDays,FileQuestion,ClipboardList,Megaphone,LogOut,ShieldCheck,Database,Send,Pencil,Plus,Trash2,X,GraduationCap,Users} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";
import {RoleWorkspace,UsersTab,TelegramCenterTab,AccountPanel,AuditTab} from "./workspace";

import {usePublicationRequest} from "./publication-review";
import {MaterialForm, type PublishingAccount} from "./material-form";
import {AssignmentForm} from "./assignment-form";

type Me = PublishingAccount & {authenticated: boolean; email?: string};
type Stats = {databaseConfigured: boolean; counts?: {table: string; count: number}[]; recentAudit?: {actor: string; action: string; created_at: string}[]};
type Row = Record<string, unknown>;

const TABS = [
  {id: "overview", label: "نظرة عامة", Icon: ShieldCheck},
  {id: "subjects", label: "المواد", Icon: GraduationCap},
  {id: "announcements", label: "التبليغات", Icon: Megaphone},
  {id: "lectures", label: "المحاضرات", Icon: BookOpen},
  {id: "exams", label: "الامتحانات", Icon: FileQuestion},
  {id: "assignments", label: "الواجبات والتكاليف", Icon: ClipboardList},
  {id: "schedule", label: "الجدول", Icon: CalendarDays},
  {id: "telegram", label: "تليجرام", Icon: Send},
] as const;
type TabId = (typeof TABS)[number]["id"] | "users" | "tgcenter" | "audit";
type WritableTab = "subjects" | "announcements" | "lectures" | "exams" | "assignments" | "schedule";

type Field = {k: string; label: string; area?: boolean; select?: string[]; num?: boolean; json?: boolean; req?: boolean};
const FIELDS: Record<Exclude<WritableTab, "lectures">, Field[]> = {
  subjects: [
    {k: "id", label: "المعرّف (id)", req: true},
    {k: "name", label: "اسم المادة", req: true},
    {k: "english_name", label: "الاسم الإنجليزي"},
    {k: "teacher", label: "التدريسي"},
    {k: "description", label: "الوصف", area: true},
    {k: "color", label: "اللون (مثل #3586d9)"},
  ],
  announcements: [
    {k: "id", label: "المعرّف (id)", req: true},
    {k: "title", label: "العنوان", req: true},
    {k: "body", label: "المحتوى", area: true},
    {k: "scope", label: "النطاق", select: ["general", "section", "teacher"]},
    {k: "section", label: "الشعبة", select: ["all", "A", "B", "C", "F"]},
    {k: "subject_id", label: "المادة (للتبليغ التدريسي)"},
    {k: "author", label: "الجهة"},
    {k: "priority", label: "الأولوية", select: ["normal", "important", "urgent"]},
    {k: "published_at", label: "تاريخ النشر"},
    {k: "pinned", label: "مثبّت", select: ["false", "true"]},
  ],
  exams: [
    {k: "id", label: "المعرّف (id)", req: true},
    {k: "subject_id", label: "المادة"},
    {k: "title", label: "العنوان", req: true},
    {k: "type", label: "النوع (كوز/نصف سنوي...)"},
    {k: "date", label: "التاريخ"},
    {k: "start_time", label: "وقت البدء"},
    {k: "room", label: "القاعة"},
    {k: "sections", label: "الشعب", json: true},
    {k: "topics", label: "المواضيع", area: true},
    {k: "notes", label: "ملاحظات", area: true},
    {k: "status", label: "الحالة", select: ["confirmed", "provisional", "cancelled"]},
  ],
  assignments: [
    {k: "id", label: "المعرّف (id)", req: true},
    {k: "subject_id", label: "المادة"},
    {k: "title", label: "العنوان", req: true},
    {k: "instructions", label: "التعليمات", area: true},
    {k: "assigned_at", label: "تاريخ التكليف"},
    {k: "due_at", label: "موعد التسليم"},
    {k: "sections", label: "الشعب", json: true},
    {k: "submission", label: "طريقة التسليم"},
    {k: "status", label: "الحالة", select: ["active", "closed", "cancelled"]},
    {k: "attachment_url", label: "رابط المرفق"},
  ],
  schedule: [
    {k: "id", label: "المعرّف (id)", req: true},
    {k: "section", label: "الشعبة", select: ["A", "B", "C", "F"], req: true},
    {k: "day", label: "اليوم (0=الأحد … 6=السبت)", num: true, req: true},
    {k: "start", label: "وقت البدء", req: true},
    {k: "end", label: "وقت الانتهاء", req: true},
    {k: "subject_id", label: "المادة"},
    {k: "teacher", label: "التدريسي"},
    {k: "room", label: "القاعة"},
    {k: "kind", label: "النوع", select: ["theory", "practical"]},
    {k: "status", label: "الحالة", select: ["normal", "moved", "cancelled", "extra"]},
    {k: "note", label: "ملاحظة"},
    {k: "periods", label: "الفترات (JSON)", json: true},
  ],
};

function readSections(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((section): section is string => typeof section === "string") : [];
  } catch {
    return [];
  }
}

const WRITE_HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

export default function AdminDashboard(){
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("overview");
  const [subjects, setSubjects] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadTab = useCallback((t: TabId) => {
    if (t === "users" || t === "tgcenter" || t === "audit") return;
    if (t === "overview") {
      fetch("/api/admin/stats", {cache: "no-store"}).then(r => r.json()).then(setStats).catch(() => setStats({databaseConfigured: false}));
    } else {
      setRows(null);
      fetch(`/api/admin/content?type=${t}`, {cache: "no-store"}).then(r => r.json()).then(j => setRows(j.rows || [])).catch(() => setRows([]));
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/me", {cache: "no-store"})
      .then(async r => { if (r.status === 401) { router.push("/admin/login"); return; } setMe(await r.json()); })
      .catch(() => router.push("/admin/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => { if (me?.authenticated) loadTab(tab); }, [me, tab, loadTab]);
  useEffect(() => {
    if (!me?.authenticated || !["super_admin", "editor"].includes(me.role || "")) return;
    fetch("/api/public/content?type=subjects", {cache: "no-store"})
      .then(r => r.json()).then(j => setSubjects(j.content?.subjects || [])).catch(() => {});
  }, [me]);

  const logout = async () => {
    await fetch("/api/admin/logout", {method: "POST", headers: WRITE_HEADERS});
    router.push("/admin/login");
  };

  const startAdd = () => {
    setEditing({});
    setForm(tab === "announcements" ? {scope: "general", section: "all", priority: "normal", pinned: "false"}
      : tab === "exams" ? {status: "provisional", sections: JSON.stringify(["A", "B", "C", "F"])}
      : tab === "assignments" ? {status: "active", sections: JSON.stringify(["A", "B", "C", "F"])} : {});
  };
  const startEdit = (row: Row) => {
    setEditing(row);
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) f[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    setForm(f);
  };
  const cancelEdit = () => { setEditing(null); setForm({}); };

  const {request, review} = usePublicationRequest();

  const submit = async (e: React.FormEvent, type: Exclude<WritableTab, "lectures">) => {
    e.preventDefault();
    setBusy(true); setNotice("");
    try {
      const row: Row = {id: editing?.id || form.id || `web-${crypto.randomUUID()}`};
      for (const f of FIELDS[type]) {
        if (f.k === "id" && type !== "subjects") continue;
        const v = (form[f.k] ?? "").trim();
        if (f.num) row[f.k] = v === "" ? null : Number(v);
        else if (f.json) row[f.k] = v === "" ? [] : JSON.parse(v);
        else if (f.k === "published_at") row[f.k] = v || new Date().toISOString();
        else if (v || !f.select) row[f.k] = v;
      }
      const {response, data: j} = await request(type, row);
      if (!response.ok) { setNotice(j.error || "فشل الحفظ"); return; }
      setNotice(j.action === "updated" ? "تم تحديث المنشور الموجود." : "تم الحفظ بنجاح");
      cancelEdit();
      loadTab(tab);
    } catch { setNotice("بيانات غير صالحة — راجع قيم JSON"); }
    finally { setBusy(false); }
  };

  const remove = async (type: WritableTab, id: string) => {
    if (!confirm("حذف هذا السجل نهائيًا من قاعدة البيانات؟")) return;
    const res = await fetch(`/api/admin/content?type=${type}&id=${encodeURIComponent(id)}`, {method: "DELETE", headers: WRITE_HEADERS});
    if (res.ok) { setNotice("تم الحذف"); loadTab(tab); } else setNotice("فشل الحذف");
  };

  if (loading) return <PageHeading title="لوحة الإدارة" description="جارٍ التحقق من الجلسة…"/>;
  if (!me?.authenticated) return <PageHeading title="لوحة الإدارة" description="غير مسجّل الدخول"/>;
  const canWrite = me.role === "super_admin" || me.role === "editor";
  // Role-specific workspaces: representatives and teachers get a focused UI, not the full admin panel
  if (!canWrite) return <><RoleWorkspace me={me}/><div style={{marginTop:18}}><AccountPanel/></div></>;
  const tabs = me.role === "super_admin"
    ? [...TABS, {id: "users" as const, label: "إدارة الحسابات", Icon: Users}, {id: "tgcenter" as const, label: "مركز Telegram", Icon: Send}, {id: "audit" as const, label: "سجل الأحداث", Icon: ShieldCheck}]
    : TABS;

  return <>
    {review}
    <PageHeading title="لوحة الإدارة" description={`${me.email} · ${me.role}`} action={<button className="action-button secondary" onClick={logout}><LogOut size={16}/> خروج</button>}/>
    {me.role === "super_admin" && <div className="note" style={{marginBottom:16}}>🎫 إدارة طلبات الدعم والردود صارت داخل <strong>👑 لوحة المالك في بوت Telegram</strong> حصراً.</div>}
    <div className="tabs admin-tabs">
      {tabs.map(t => <button key={t.id} className={tab === t.id ? "selected" : ""} onClick={() => { setTab(t.id); cancelEdit(); }}><t.Icon size={15}/> {t.label}</button>)}
    </div>

    {notice && <p className="note" role="status">{notice}</p>}

    {tab === "overview" && <>
      <button className="action-button" onClick={() => {setTab("lectures"); startAdd();}}><Plus size={16}/> نشر محاضرة أو ملخص</button>
      <div className="stats">
        <div className="stat"><Database size={21}/><span>قاعدة البيانات</span><strong>{stats?.databaseConfigured ? "متصلة" : "غير مهيأة"}</strong></div>
        {stats?.counts?.filter(c => c.table.startsWith("portal_")).map(c => (
          <div className="stat" key={c.table}><ShieldCheck size={21}/><span>{c.table.replace("portal_", "")}</span><strong>{c.count}</strong></div>
        ))}
      </div>
      <div className="two-col">
        <div className="panel"><div className="panel-heading"><h2>آخر الإجراءات</h2></div><div className="panel-body">
          {stats?.recentAudit?.length ? stats.recentAudit.map((a, i) => <div className="kv" key={i}><span>{a.action}</span><strong>{a.actor} · {new Date(a.created_at).toLocaleString("ar-IQ")}</strong></div>) : <Empty description="لا يوجد سجل بعد."/>}
        </div></div>
        <div className="panel"><div className="panel-heading"><h2>حالة الخدمات</h2></div><div className="panel-body">
          <p className="subtle small">إشعارات (tg_*): {stats?.counts?.filter(c => c.table.startsWith("tg_")).map(c => `${c.table.replace("tg_", "")}: ${c.count}`).join(" · ") || "—"}</p>
          <p className="subtle small">المستخدم الحالي: <Status tone="success">{me.role}</Status></p>
          <p className="subtle small">الواجهة التجريبية القديمة: <a className="text-link" href="/admin-legacy">/admin-legacy</a> (محمية بنفس الجلسة)</p>
        </div></div>
      </div>
    </>}

    {tab === "telegram" && <TelegramPanel onChanged={() => loadTab("telegram")} canWrite={canWrite} rows={rows}/>}

    {tab === "users" && me.role === "super_admin" && <UsersTab/>}
    {tab === "tgcenter" && me.role === "super_admin" && <TelegramCenterTab/>}
    {tab === "audit" && me.role === "super_admin" && <AuditTab/>}

    {tab !== "overview" && tab !== "telegram" && tab !== "users" && tab !== "tgcenter" && tab !== "audit" && <div className="panel">
      <div className="panel-heading"><h2>{TABS.find(t => t.id === tab)?.label}</h2>
        <span className="subtle small">{rows ? `${rows.length} سجل` : "…"}</span>
        {canWrite && (editing === null ? <button className="action-button" onClick={startAdd}><Plus size={15}/> إضافة جديد</button> : <button className="action-button secondary" onClick={cancelEdit}><X size={15}/> إلغاء</button>)}
      </div>
      <div className="panel-body">
        {canWrite && editing !== null && tab === "lectures" && <MaterialForm key={String(editing.id || "new")} account={me} initial={editing.id ? editing : undefined} rows={rows || []} onSaved={() => loadTab("lectures")}/>}
        {canWrite && editing !== null && tab === "assignments" && <AssignmentForm key={String(editing.id || "new")} account={me} initial={editing.id ? editing : undefined} onSaved={() => {cancelEdit();loadTab("assignments");}}/>}
        {canWrite && editing !== null && tab !== "lectures" && tab !== "assignments" && <form className="admin-form" onSubmit={e => submit(e, tab)} style={{marginBottom: 18}}>
          {FIELDS[tab].filter(f => (f.k !== "id" || tab === "subjects") && (f.k !== "published_at" || !!editing.id)).map(f => (
            <label className={"form-field" + (f.area ? " wide" : "")} key={f.k}><span>{f.label}{f.req ? " *" : ""}</span>
              {f.k === "subject_id" ? <select value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}>
                <option value="">اختر المادة</option>
                {subjects.map(subject => <option key={String(subject.id)} value={String(subject.id)}>{String(subject.name)}</option>)}
                {form[f.k] && !subjects.some(subject => subject.id === form[f.k]) && <option value={form[f.k]}>{form[f.k]}</option>}
              </select> : f.k === "sections" ? <div className="section-pills">
                {["A", "B", "C", "F"].map(section => <label key={section}>
                  <input type="checkbox" checked={readSections(form.sections).includes(section)} onChange={e => {
                    const selected = readSections(form.sections);
                    const next = e.target.checked ? [...selected, section] : selected.filter(value => value !== section);
                    setForm(v => ({...v, sections: JSON.stringify(next)}));
                  }}/> {section}
                </label>)}
              </div> : f.select ? <select value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}>
                <option value="">—</option>
                {f.select.map(o => <option key={o} value={o}>{f.k === "material_kind" ? (o === "summary" ? "ملخص" : "محاضرة / ملزمة") : o}</option>)}
              </select>
              : f.area ? <textarea rows={3} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}/>
              : <input type={f.num ? "number" : "text"} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}/>}
            </label>
          ))}
          <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}} disabled={busy}><ShieldCheck size={15}/> {busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        </form>}
        {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map((r, i) => <div className="list-row" key={String(r.id || i)}>
          <div className="grow"><strong>{String(r.title || r.name || r.id)}</strong><p className="subtle small">{String(r.subject_id || r.section || "")}</p></div>
          {canWrite && <button className="action-button secondary" title="تعديل" onClick={() => startEdit(r)}><Pencil size={14}/></button>}
          {canWrite && <button className="action-button secondary" title="حذف" onClick={() => remove(tab as WritableTab, String(r.id))}><Trash2 size={14}/></button>}
        </div>)}</div> : <Empty description="لا توجد بيانات بعد — استخدم «إضافة جديد»."/>}
      </div>
    </div>}
  </>;
}

function TelegramPanel({onChanged, canWrite, rows}: {onChanged: () => void; canWrite: boolean; rows: Row[] | null}) {
  const [kind, setKind] = useState("general");
  const [key, setKey] = useState("general");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/content", {method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({type: "telegram", kind, key, url})});
    const j = await res.json().catch(() => ({}));
    setNotice(res.ok ? "تم حفظ القناة" : (j.error || "فشل الحفظ"));
    if (res.ok) onChanged();
  };
  return <div className="panel">
    <div className="panel-heading"><h2><BellRing size={19}/> قنوات تليجرام</h2></div>
    <div className="panel-body">
      {notice && <p className="note" role="status">{notice}</p>}
      {canWrite && <form className="admin-form" onSubmit={save} style={{marginBottom: 16}}>
        <label className="form-field"><span>النوع</span>
          <select value={kind} onChange={e => { setKind(e.target.value); setKey(e.target.value === "general" ? "general" : ""); }}>
            <option value="general">قناة عامة</option><option value="section">قناة شعبة</option><option value="subject">قناة مادة</option>
          </select></label>
        <label className="form-field"><span>المفتاح (مثل A أو nonlinear-optics)</span><input value={key} onChange={e => setKey(e.target.value)} required/></label>
        <label className="form-field wide"><span>الرابط (https://t.me/…)</span><input dir="ltr" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://t.me/…"/></label>
        <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}}>حفظ القناة</button>
      </form>}
      {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map((r, i) => <div className="list-row" key={i}>
        <div className="grow"><strong>{String(r.kind)} · {String(r.key)}</strong><p className="subtle small" dir="ltr">{String(r.url)}</p></div>
        {canWrite && <button className="action-button secondary" title="تعديل" onClick={() => { setKind(String(r.kind)); setKey(String(r.key)); setUrl(String(r.url)); }}><Pencil size={14}/></button>}
      </div>)}</div> : <Empty description="لا توجد قنوات بعد."/>}
      <p className="subtle small" style={{marginTop: 12}}>مركز إشعارات البوت: <code>/api/telegram/admin</code> — الحالة: <code>/api/telegram/health</code>. البوت معطّل افتراضيًا.</p>
    </div>
  </div>;
}
