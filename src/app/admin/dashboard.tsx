"use client";
import React,{useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {BellRing,CalendarDays,FileQuestion,LogOut,ShieldCheck,Database,Send,Pencil,Plus,X,GraduationCap,Users,House,Layers,Ellipsis,KeyRound,ChevronLeft} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";
import {RoleWorkspace,UsersTab,TelegramCenterTab,AuditTab} from "./workspace";

import {usePublicationRequest} from "./publication-review";
import {MaterialForm, type PublishingAccount} from "./material-form";
import {AssignmentForm} from "./assignment-form";
import {ExamForm} from "./exam-form";
import {CONTENT_SECTIONS, AdminNavGroup, ContentList, useAdminRows, type PublicationType} from "./content-navigation";

type Me = PublishingAccount & {authenticated: boolean; email?: string; name?: string};
type Stats = {databaseConfigured: boolean; counts?: {table: string; count: number}[]};
type Row = Record<string, unknown>;
type WritableTab = "subjects" | PublicationType | "schedule";
type TabId = WritableTab | "overview" | "content" | "calendar" | "more" | "examSchedule" | "telegram" | "telegramTools" | "account" | "users" | "tgcenter" | "audit" | "services";
type PrimaryTab = "overview" | "content" | "calendar" | "more";

const PRIMARY_TABS = [
  {id: "overview", label: "الرئيسية", Icon: House},
  {id: "content", label: "المحتوى", Icon: Layers},
  {id: "calendar", label: "الجداول", Icon: CalendarDays},
  {id: "more", label: "المزيد", Icon: Ellipsis},
] as const;
const CALENDARS = [
  {id: "schedule", label: "الجدول الأسبوعي", Icon: CalendarDays},
  {id: "examSchedule", label: "الميدتيرم والفاينل", Icon: FileQuestion},
] as const;
const SETTINGS = [
  {id: "subjects", label: "إدارة المواد", Icon: GraduationCap},
  {id: "users", label: "حسابات التدريسيين والممثلين", Icon: Users, owner: true},
  {id: "telegramTools", label: "تيليجرام", Icon: Send},
  {id: "account", label: "حسابي وأمان الدخول", Icon: KeyRound},
  {id: "audit", label: "سجل الأحداث", Icon: ShieldCheck, owner: true},
  {id: "services", label: "التشخيص الفني", Icon: Database, owner: true},
] as const;
const TELEGRAM_TOOLS = [
  {id: "tgcenter", label: "إدارة البوت", Icon: Send, owner: true},
  {id: "telegram", label: "روابط القنوات للطلاب", Icon: BellRing},
] as const;

function primaryTab(tab: TabId): PrimaryTab {
  if (tab === "overview") return "overview";
  if (tab === "content" || CONTENT_SECTIONS.some(item => item.id === tab)) return "content";
  if (tab === "calendar" || CALENDARS.some(item => item.id === tab)) return "calendar";
  return "more";
}

type Field = {k: string; label: string; area?: boolean; select?: string[]; num?: boolean; json?: boolean; req?: boolean};
const FIELDS: Record<"subjects" | "announcements" | "schedule", Field[]> = {
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

const WRITE_HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

export default function AdminDashboard(){
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("overview");
  const [subjects, setSubjects] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [publishing, setPublishing] = useState(false);
  const isOverview = tab === "overview";
  const publication = CONTENT_SECTIONS.find(item => item.id === tab);
  const calendar = CALENDARS.find(item => item.id === tab);
  const setting = SETTINGS.find(item => item.id === tab);
  const dataType = tab === "examSchedule" ? "exams" : publication || calendar || tab === "subjects" || tab === "telegram" ? tab : null;
  const {rows, failed: rowsFailed, reload} = useAdminRows(me?.authenticated && ["super_admin", "editor"].includes(me.role || "") ? dataType : null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const draftId = useRef("");

  useEffect(() => {
    fetch("/api/admin/me", {cache: "no-store"})
      .then(async r => { if (r.status === 401) { router.push("/admin/login"); return; } setMe(await r.json()); })
      .catch(() => router.push("/admin/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!me?.authenticated || me.role !== "super_admin" || tab !== "services") return;
    const controller = new AbortController();
    fetch("/api/admin/stats", {cache: "no-store", signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Stats unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) { setStats(data); setStatsFailed(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setStatsFailed(true); });
    return () => controller.abort();
  }, [me, tab]);
  useEffect(() => {
    if (!me?.authenticated) return;
    fetch("/api/public/content?type=subjects", {cache: "no-store"})
      .then(r => r.json()).then(j => setSubjects(j.content?.subjects || [])).catch(() => {});
  }, [me]);

  const logout = async () => {
    await fetch("/api/admin/logout", {method: "POST", headers: WRITE_HEADERS});
    router.push("/admin/login");
  };

  function navigate(next: TabId) {
    setTab(next);
    setPublishing(false);
    setNotice("");
    cancelEdit();
  }

  function startAdd(next: TabId = tab) {
    navigate(next);
    setEditing({});
    setForm(next === "announcements" ? {scope: "general", section: "all", priority: "normal", pinned: "false"} : {});
  }
  function startEdit(row: Row) {
    setEditing(row);
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) f[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    setForm(f);
    setNotice("");
  }
  const cancelEdit = () => { setEditing(null); setForm({}); draftId.current = ""; };

  const {request, review} = usePublicationRequest();

  const submit = async (e: React.FormEvent, type: "subjects" | "announcements" | "schedule") => {
    e.preventDefault();
    setBusy(true); setNotice("");
    try {
      if (!draftId.current) draftId.current = `web-${crypto.randomUUID()}`;
      const row: Row = {id: editing?.id || form.id || draftId.current};
      for (const f of FIELDS[type]) {
        if (f.k === "id" && type !== "subjects") continue;
        const v = (form[f.k] ?? "").trim();
        if (f.num) row[f.k] = v === "" ? null : Number(v);
        else if (f.json) row[f.k] = v === "" ? [] : JSON.parse(v);
        else if (f.k === "published_at") row[f.k] = v || new Date().toISOString();
        else if (v || !f.select) row[f.k] = v;
      }
      const {response, data: j} = await request(type, row, {editing: Boolean(editing?.id), subject: String(subjects.find(subject => subject.id === row.subject_id)?.name || "")});
      if (j.cancelled) return;
      if (!response.ok) { setNotice(j.error || "فشل الحفظ"); return; }
      setNotice(j.action === "updated" ? "تم تحديث المنشور الموجود." : "تم الحفظ بنجاح");
      cancelEdit();
      reload();
    } catch { setNotice("بيانات غير صالحة — راجع قيم JSON"); }
    finally { setBusy(false); }
  };

  const remove = async (type: WritableTab, id: string) => {
    if (!confirm("حذف هذا السجل نهائيًا من قاعدة البيانات؟")) return;
    try {
      const res = await fetch(`/api/admin/content?type=${type}&id=${encodeURIComponent(id)}`, {method: "DELETE", headers: WRITE_HEADERS});
      if (!res.ok) throw new Error("Delete failed");
      setNotice("تم الحذف");
      reload();
    } catch { setNotice("تعذّر حذف المحتوى."); }
  };

  if (loading) return <PageHeading title="لوحة الإدارة" description="جارٍ التحقق من الجلسة…"/>;
  if (!me?.authenticated) return <PageHeading title="لوحة الإدارة" description="غير مسجّل الدخول"/>;
  const passkeyLink = ["super_admin", "teacher", "section_representative", "general_representative"].includes(me.role || "")
    ? <a className="action-button secondary" href="/admin/passkeys"><KeyRound size={17}/> مفاتيح الدخول</a> : null;
  const canWrite = me.role === "super_admin" || me.role === "editor";
  if (!canWrite) return <RoleWorkspace me={me} subjects={subjects} passkeyLink={passkeyLink} onLogout={logout}/>;
  const owner = me.role === "super_admin";
  const group = primaryTab(tab);
  const calendars = CALENDARS.filter(item => item.id !== "examSchedule" || owner);
  const settings = SETTINGS.filter(item => !("owner" in item) || owner);
  const settingsSelection = tab === "tgcenter" || tab === "telegram" ? "telegramTools" : tab;
  const visibleRows = rows?.filter(row => tab === "exams" ? row.type === "كوز يومي" : tab === "examSchedule" ? row.type !== "كوز يومي" : true);
  const listing = publication || calendar || tab === "subjects";
  const sectionTitle = publication?.label || calendar?.label || setting?.label;
  const title = sectionTitle || ({overview: "لوحة الإدارة", content: "المحتوى", calendar: "الجداول", more: "الإعدادات", telegram: "روابط القنوات للطلاب", tgcenter: "إدارة البوت"} as Partial<Record<TabId, string>>)[tab] || "لوحة الإدارة";
  function saved() {
    cancelEdit();
    reload();
    setNotice("تم الحفظ بنجاح.");
  }

  return <div className="admin-shell admin-workspace-layout">
    <nav className="admin-desktop-nav" aria-label="أقسام الإدارة">
      <AdminNavGroup items={PRIMARY_TABS.slice(0, 1)} active={tab} onSelect={navigate}/>
      <AdminNavGroup label="المحتوى" items={CONTENT_SECTIONS} active={tab} onSelect={navigate}/>
      <AdminNavGroup label="الجداول" items={calendars} active={tab} onSelect={navigate}/>
      <AdminNavGroup label="الإعدادات" items={settings} active={settingsSelection} onSelect={navigate}/>
      <button type="button" className="admin-side-logout" onClick={logout}><LogOut size={17}/> تسجيل الخروج</button>
    </nav>
    <div className="admin-workspace-main">
    {review}
    <PageHeading title={title} description={isOverview ? me.name || me.email : undefined} action={!editing && (
      listing ? <button type="button" className="action-button admin-publish" onClick={() => startAdd()}><Plus size={18}/> {publication ? "إضافة " + publication.addLabel : "إضافة"}</button>
        : <button type="button" className="action-button admin-publish" aria-expanded={publishing} onClick={() => setPublishing(value => !value)}><Plus size={18}/> نشر جديد</button>
    )}/>
    {publishing && <section className="panel admin-publish-picker" aria-label="نوع المنشور">
      <div className="panel-heading"><h2>شنو تريد تنشر؟</h2></div>
      <div className="panel-body admin-option-grid">{CONTENT_SECTIONS.map(({id, addLabel, Icon}) =>
        <button type="button" key={id} className="admin-option" onClick={() => startAdd(id)}><Icon size={18}/>{addLabel}</button>
      )}</div>
    </section>}
    <nav className="admin-primary-nav" aria-label="أقسام الإدارة">
      {PRIMARY_TABS.map(({id, label, Icon}) => <button type="button" key={id} aria-current={group === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={19}/>{label}</button>)}
    </nav>

    {notice && <p className="note" role="status">{notice}</p>}

    {(isOverview || tab === "content") && <section className="admin-home-content" aria-label="إدارة المحتوى">
      {isOverview && <h2>إدارة المحتوى</h2>}
      <div className="admin-home-grid">{CONTENT_SECTIONS.map(({id, label, Icon}) =>
        <button type="button" key={id} className="admin-home-item" onClick={() => navigate(id)}>
          <span className="admin-home-icon"><Icon size={21}/></span><strong>{label}</strong><ChevronLeft size={16} className="admin-home-arrow"/>
        </button>
      )}</div>
    </section>}
    {tab === "calendar" && <div className="admin-option-grid">{calendars.map(({id, label, Icon}) =>
      <button type="button" key={id} className="admin-option" onClick={() => navigate(id)}><Icon size={21}/>{label}</button>
    )}</div>}
    {tab === "more" && <div className="admin-option-grid">
      {settings.map(({id, label, Icon}) =>
        <button type="button" key={id} className="admin-option" onClick={() => navigate(id)}><Icon size={20}/>{label}</button>
      )}
      <button type="button" className="admin-option" onClick={logout}><LogOut size={20}/> تسجيل الخروج</button>
    </div>}

    {tab === "telegramTools" && <section className="panel">
      <div className="panel-heading"><h2>تيليجرام</h2></div>
      <div className="panel-body admin-option-grid">{TELEGRAM_TOOLS.filter(item => !("owner" in item) || owner).map(({id, label, Icon}) =>
        <button type="button" key={id} className="admin-option" onClick={() => navigate(id)}><Icon size={20}/>{label}</button>
      )}</div>
    </section>}
    {(tab === "telegram" || tab === "tgcenter") && <button type="button" className="action-button secondary admin-back-link" onClick={() => navigate("telegramTools")}>رجوع إلى تيليجرام</button>}
    {tab === "account" && <section className="panel">
      <div className="panel-heading"><h2>حسابي وأمان الدخول</h2></div>
      <div className="panel-body stack"><p>{me.email}</p>{passkeyLink}<button type="button" className="action-button secondary" onClick={logout}><LogOut size={16}/> تسجيل الخروج</button></div>
    </section>}
    {tab === "telegram" && (rowsFailed ? <Empty title="تعذّر تحميل القنوات" description="حاول فتح القسم مجدداً."/> : <TelegramPanel onChanged={reload} canWrite={canWrite} rows={rows} subjects={subjects}/>)}
    {tab === "users" && owner && <UsersTab/>}
    {tab === "tgcenter" && owner && <TelegramCenterTab/>}
    {tab === "audit" && owner && <AuditTab/>}
    {tab === "services" && owner && <section className="panel">
      <div className="panel-heading"><h2>التشخيص الفني</h2></div>
      <div className="panel-body stack">
        <div className="kv"><span>قاعدة البيانات</span><Status tone={stats?.databaseConfigured ? "success" : "warning"}>{statsFailed ? "تعذّر التحقق" : stats ? (stats.databaseConfigured ? "متصلة" : "غير مهيأة") : "جارٍ التحقق"}</Status></div>
        {stats?.counts?.filter(item => item.table.startsWith("tg_")).map(item => <div className="kv" key={item.table}><span>{{tg_subscribers: "مشتركو البوت", tg_events: "أحداث الإشعارات", tg_deliveries: "عمليات إرسال الإشعارات"}[item.table]}</span><strong>{item.count}</strong></div>)}
        <a className="text-link" href="/admin-legacy">لوحة الإدارة القديمة</a>
        <p className="subtle small">إدارة طلبات الدعم والردود من لوحة المالك في بوت Telegram.</p>
      </div>
    </section>}

    {listing && <div className={"admin-content-layout" + (editing ? " admin-is-editing" : "")}>
      <section className="panel admin-list-pane" aria-label={sectionTitle}>
        <div className="panel-body">
          {rowsFailed ? <Empty title="تعذّر تحميل المحتوى" description="حاول فتح القسم مجدداً."/> : !visibleRows ? <p className="subtle" role="status">جارٍ التحميل…</p> :
            <ContentList key={tab} onChanged={reload} kind={tab} rows={visibleRows} subjects={subjects} selected={editing?.id ? String(editing.id) : undefined}
              onEdit={startEdit} onRemove={row => {
                if (row.id === editing?.id) setNotice("أغلق نموذج التعديل قبل حذف هذا المنشور.");
                else void remove((tab === "examSchedule" ? "exams" : tab) as WritableTab, String(row.id));
              }}/>}
        </div>
      </section>
      {editing && <section className="panel admin-editor-pane" aria-label={editing.id ? "تعديل المنشور" : "إضافة منشور"}>
        <div className="panel-heading">
          <h2>{editing.id ? "تعديل" : "إضافة"} · {sectionTitle}</h2>
          <button type="button" className="action-button secondary" onClick={cancelEdit} disabled={busy}><X size={16}/> إغلاق</button>
        </div>
        <div className="panel-body">
        {editing && tab === "lectures" && <MaterialForm key={String(editing.id || "new")} account={me} initial={editing.id ? editing : undefined} rows={rows || []} onSaved={reload}/>}
        {editing && tab === "assignments" && <AssignmentForm key={String(editing.id || "new")} account={me} initial={editing.id ? editing : undefined} onSaved={saved}/>}
        {editing && (tab === "exams" || tab === "examSchedule") && <ExamForm key={String(editing.id || "new")} account={me} initial={editing.id ? editing : undefined} mode={tab === "examSchedule" ? "schedule" : "quiz"} onSaved={saved}/>}
        {editing && (tab === "subjects" || tab === "announcements" || tab === "schedule") && <form className="admin-form" onSubmit={e => submit(e, tab)} style={{marginBottom: 18}}>
          {FIELDS[tab].filter(f => (f.k !== "id" || tab === "subjects") && (f.k !== "published_at" || !!editing.id)).map(f => (
            <label className={"form-field" + (f.area ? " wide" : "")} key={f.k}><span>{f.label}{f.req ? " *" : ""}</span>
              {f.k === "subject_id" ? <select required={f.req} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}>
                <option value="">اختر المادة</option>
                {subjects.map(subject => <option key={String(subject.id)} value={String(subject.id)}>{String(subject.name)}</option>)}
                {form[f.k] && !subjects.some(subject => subject.id === form[f.k]) && <option value={form[f.k]}>{form[f.k]}</option>}
              </select> : f.select ? <select required={f.req} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}>
                <option value="">—</option>
                {f.select.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              : f.area ? <textarea required={f.req} rows={3} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}/>
              : <input required={f.req} type={f.num ? "number" : "text"} value={form[f.k] ?? ""} onChange={e => setForm(v => ({...v, [f.k]: e.target.value}))}/>}
            </label>
          ))}
          <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}} disabled={busy}><ShieldCheck size={15}/> {busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        </form>}
        </div>
      </section>}
    </div>}
    </div>
  </div>;
}

function TelegramPanel({onChanged, canWrite, rows, subjects}: {onChanged: () => void; canWrite: boolean; rows: Row[] | null; subjects: Row[]}) {
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
    <div className="panel-heading"><h2><BellRing size={19}/> روابط القنوات للطلاب</h2></div>
    <div className="panel-body">
      {notice && <p className="note" role="status">{notice}</p>}
      {canWrite && <form className="admin-form" onSubmit={save} style={{marginBottom: 16}}>
        <label className="form-field"><span>النوع</span>
          <select value={kind} onChange={e => { setKind(e.target.value); setKey(e.target.value === "general" ? "general" : ""); }}>
            <option value="general">قناة عامة</option><option value="section">قناة شعبة</option><option value="subject">قناة مادة</option>
          </select></label>
        {kind !== "general" && <label className="form-field"><span>{kind === "section" ? "الشعبة" : "المادة"}</span>
          <select required value={key} onChange={e => setKey(e.target.value)}>
            <option value="">اختر {kind === "section" ? "الشعبة" : "المادة"}</option>
            {kind === "section" ? ["A", "B", "C", "F"].map(section => <option key={section}>{section}</option>)
              : subjects.map(subject => <option key={String(subject.id)} value={String(subject.id)}>{String(subject.name)}</option>)}
            {key && !(kind === "section" ? ["A", "B", "C", "F"].includes(key) : subjects.some(subject => subject.id === key)) && <option value={key}>{key}</option>}
          </select>
        </label>}
        <label className="form-field wide"><span>الرابط (https://t.me/…)</span><input dir="ltr" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://t.me/…"/></label>
        <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}}>حفظ القناة</button>
      </form>}
      {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map((r, i) => <div className="list-row" key={i}>
        <div className="grow"><strong>{r.kind === "general" ? "القناة العامة" : r.kind === "section" ? "شعبة " + r.key : subjects.find(subject => subject.id === r.key)?.name as string || String(r.key)}</strong><p className="subtle small" dir="ltr">{String(r.url)}</p></div>
        {canWrite && <button className="action-button secondary" title="تعديل" onClick={() => { setKind(String(r.kind)); setKey(String(r.key)); setUrl(String(r.url)); }}><Pencil size={14}/></button>}
      </div>)}</div> : <Empty description="لا توجد قنوات بعد."/>}
    </div>
  </div>;
}
