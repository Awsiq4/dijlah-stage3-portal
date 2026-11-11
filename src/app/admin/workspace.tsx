"use client";
import {TELEGRAM_STAFF_ROLES} from "@/lib/telegram-roles";
import React,{useCallback,useEffect,useState} from "react";
import {BookOpen,ClipboardList,FileQuestion,Megaphone,Paperclip,Plus,Send,Trash2,Users,Link2,Unlink} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";
import {usePublicationRequest} from "./publication-review";
import {MaterialForm, type PublishingAccount} from "./material-form";

type Me = PublishingAccount & {authenticated: boolean; email?: string; name?: string};
type Row = Record<string, unknown>;
const WRITE_HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

// ---------- role-specific workspace (representatives & teachers) ----------
export function RoleWorkspace({me}: {me: Me}) {
  const {request, review} = usePublicationRequest();
  const isRep = me.role === "section_representative" || me.role === "general_representative";
  const [type, setType] = useState<"announcements" | "lectures">("lectures");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    let active = true;
    fetch(`/api/admin/content?type=${type}`, {cache: "no-store"})
      .then(response => response.json())
      .then(data => { if (active) setRows(data.rows || []); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [type]);
  useEffect(() => load(), [load]);

  async function publishAnnouncement(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    setNotice("");
    const ownSection = me.role === "section_representative";
    const row = {
      id: `web-${crypto.randomUUID()}`, title: title.trim(), body: body.trim(),
      scope: ownSection ? "section" : "general", section: ownSection ? me.assigned_section : "all",
      priority: "normal", published_at: new Date().toISOString(), pinned: "false",
    };
    try {
      const {response, data} = await request(type, row);
      if (!response.ok) { setNotice(data.error || "تعذّر نشر التبليغ."); return; }
      setTitle(""); setBody(""); setNotice(data.action === "updated" ? "تم تحديث التبليغ." : "تم نشر التبليغ."); load();
    } catch { setNotice("تعذّر نشر التبليغ. حاول مرة ثانية."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("حذف هذا المحتوى؟")) return;
    const response = await fetch(`/api/admin/content?type=${type}&id=${encodeURIComponent(id)}`, {method: "DELETE", headers: WRITE_HEADERS});
    if (response.ok) load();
    else setNotice("تعذّر حذف المحتوى.");
  }

  return <>
    {review}
    <PageHeading title={type === "lectures" ? "نشر ملف PDF" : "نشر تبليغ"} description={me.name || me.email}/>
    {isRep && <div className="tabs admin-tabs">
      <button className={type === "lectures" ? "selected" : ""} onClick={() => {setType("lectures"); setRows(null); setNotice("");}}>محاضرة أو ملخص</button>
      <button className={type === "announcements" ? "selected" : ""} onClick={() => {setType("announcements"); setRows(null); setNotice("");}}>تبليغ</button>
    </div>}
    <div className="panel"><div className="panel-body">
      {type === "lectures" ? <MaterialForm account={me} rows={rows || []} onSaved={() => { load(); }}/> :
        <form className="admin-form" onSubmit={publishAnnouncement}>
          <label className="form-field wide"><span>العنوان</span><input required value={title} onChange={e => setTitle(e.target.value)}/></label>
          <label className="form-field wide"><span>نص التبليغ</span><textarea required rows={4} value={body} onChange={e => setBody(e.target.value)}/></label>
          <button className="action-button" disabled={busy}><Send size={15}/> {busy ? "جارٍ النشر…" : "نشر التبليغ"}</button>
        </form>}
      {notice && <p className="note" role="status">{notice}</p>}
    </div></div>
    <div className="panel"><div className="panel-heading"><h2>{type === "lectures" ? "ملفاتي" : "تبليغاتي"}</h2></div><div className="panel-body">
      {rows === null ? <Empty description="جارٍ التحميل…"/> : !rows.length ? <Empty description="لا يوجد محتوى منشور بعد."/> : rows.map(row =>
        <div className="list-row" key={String(row.id)}>
          <div className="grow"><strong>{String(row.title || row.id)}</strong></div>
          <button className="action-button secondary" aria-label="حذف" onClick={() => remove(String(row.id))}><Trash2 size={14}/></button>
        </div>)}
    </div></div>
  </>;
}

// ---------- super admin: إدارة الحسابات والصلاحيات ----------
export function UsersTab() {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [subjects, setSubjects] = useState<Row[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [invitations, setInvitations] = useState<Row[] | null>(null);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({email: "", name: "", role: "section_representative", assigned_section: "A", telegram_user_id: "", telegram_username: ""});
  const [busy, setBusy] = useState(false);
  const canAssignTelegram = TELEGRAM_STAFF_ROLES.includes(form.role);

  const load = useCallback(() => {
    fetch("/api/admin/users", {cache: "no-store"}).then(r => r.json()).then(j => { setUsers(j.users || []); setInvitations(j.invitations || []); }).catch(() => setUsers([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/public/content?type=subjects", {cache: "no-store"}).then(r => r.json()).then(j => setSubjects(j.content?.subjects || [])).catch(() => setSubjects([]));
  }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setNotice("");
    const res = await fetch("/api/admin/users", {method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({
      email: form.email, name: form.name, role: form.role,
      assigned_section: form.role === "section_representative" ? form.assigned_section : null,
      assigned_subjects: form.role === "teacher" ? selectedSubjects : [],
      telegram_user_id: canAssignTelegram ? form.telegram_user_id : "",
      telegram_username: canAssignTelegram ? form.telegram_username : "",
    })});
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNotice(j.error || "فشل إنشاء الدعوة"); return; }
    setNotice(`✅ تم إنشاء الدعوة. رابط التفعيل (مرة واحدة): ${j.setupUrl}`);
    setForm({email: "", name: "", role: "section_representative", assigned_section: "A", telegram_user_id: "", telegram_username: ""});
    load();
  };

  const setStatus = async (id: number, status: "active" | "suspended") => {
    if (status === "suspended" && !confirm("تعليق الحساب يسحب الجلسات وروابط Telegram فورًا — متابعة؟")) return;
    await fetch("/api/admin/users", {method: "PATCH", headers: WRITE_HEADERS, body: JSON.stringify({id, status})});
    load();
  };

  return <>
    <div className="panel"><div className="panel-heading"><h2><Plus size={18}/> إضافة مستخدم (دعوة)</h2></div><div className="panel-body">
    {notice && <p className="note" role="status">{notice}</p>}
      <form className="admin-form" onSubmit={invite}>
        <label className="form-field"><span>الاسم *</span><input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required/></label>
        <label className="form-field"><span>البريد الإلكتروني *</span><input dir="ltr" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required/></label>
        <label className="form-field"><span>الدور *</span>
          <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
            <option value="section_representative">ممثل شعبة</option>
            <option value="general_representative">ممثل عام</option>
            <option value="teacher">تدريسي</option>
            <option value="viewer">Viewer (قراءة فقط)</option>
          </select></label>
        {form.role === "section_representative" && <label className="form-field"><span>الشعبة</span>
          <select value={form.assigned_section} onChange={e => setForm(f => ({...f, assigned_section: e.target.value}))}>
            {["A", "B", "C", "F"].map(s => <option key={s} value={s}>شعبة {s}</option>)}
          </select></label>}
        {canAssignTelegram && <>
          <label className="form-field"><span>رقم Telegram ID (اختياري)</span>
            <input dir="ltr" inputMode="numeric" value={form.telegram_user_id}
              onChange={e => setForm(f => ({...f, telegram_user_id: e.target.value}))}/>
          </label>
          <label className="form-field"><span>اسم مستخدم Telegram (اختياري)</span>
            <input dir="ltr" placeholder="@username" value={form.telegram_username}
              onChange={e => setForm(f => ({...f, telegram_username: e.target.value}))}/>
          </label>
          <p className="subtle small wide">أدخل الرقم ليرتبط الحساب عند فتح البوت بعد تفعيل الدعوة. اسم المستخدم للتعريف فقط.</p>
        </>}
        {form.role === "teacher" && <div className="form-field wide"><span>المواد المسندة (من قاعدة البيانات)</span>
          <div style={{display: "flex", flexWrap: "wrap", gap: 8}}>
            {subjects.map(sub => <label key={String(sub.id)} style={{display: "flex", gap: 6, alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 10px"}}>
              <input type="checkbox" checked={selectedSubjects.includes(String(sub.id))} onChange={e => setSelectedSubjects(prev => e.target.checked ? [...prev, String(sub.id)] : prev.filter(x => x !== String(sub.id)))}/>
              <span>{String(sub.name)}</span>
            </label>)}
          </div></div>}
        <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}} disabled={busy}>إنشاء دعوة</button>
      </form>
    </div></div>

    <div className="panel"><div className="panel-heading"><h2><Users size={18}/> الحسابات</h2></div><div className="panel-body">
      {users === null ? <Empty description="جارٍ التحميل…"/> : users.length ? <div className="stack">{users.map(u => <div className="list-row" key={String(u.id)}>
        <div className="grow"><strong>{String(u.name || u.email)}</strong><p className="subtle small">{String(u.email)} · {String(u.role)} · {String(u.assigned_section || "")} {u.telegram_user_id ? "· Telegram مربوط" : u.telegram_expected_id ? "· بانتظار فتح البوت" : ""}</p></div>
        <Status tone={u.status === "suspended" ? "danger" : "success"}>{String(u.status || "active")}</Status>
        {u.status !== "suspended"
          ? <button className="action-button secondary" onClick={() => setStatus(Number(u.id), "suspended")}>تعليق</button>
          : <button className="action-button secondary" onClick={() => setStatus(Number(u.id), "active")}>تفعيل</button>}
      </div>)}</div> : <Empty description="لا توجد حسابات بعد."/>}
    </div></div>

    <div className="panel"><div className="panel-heading"><h2>الدعوات</h2></div><div className="panel-body">
      {invitations === null ? <Empty description="…"/> : invitations.length ? <div className="stack">{invitations.map(v => <div className="list-row" key={String(v.id)}>
        <div className="grow"><strong>{String(v.email)}</strong><p className="subtle small">{String(v.role)} · {String(v.assigned_section || "")} · تنتهي {new Date(String(v.expires_at)).toLocaleString("ar-IQ")}{Boolean(v.telegram_expected_id) && <> · Telegram ID <bdi>{String(v.telegram_expected_id)}</bdi>{v.telegram_expected_username ? <> · <bdi>@{String(v.telegram_expected_username)}</bdi></> : null}</>}</p></div>
        <Status tone={v.used_at ? "muted" : "success"}>{v.used_at ? "مستخدمة" : "فعالة"}</Status>
      </div>)}</div> : <Empty description="لا توجد دعوات."/>}
    </div></div>
  </>;
}

// ---------- super admin: مركز Telegram ----------
export function TelegramCenterTab() {
  const [stats, setStats] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<Row[] | null>(null);
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const [botStatus, setBotStatus] = useState<{enabled: boolean; webhook?: {host: string | null; path: string | null; pending: number; lastErrorAt: number | null} | null} | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/telegram/admin", {cache: "no-store"}).then(r => r.ok ? r.json() : null).then(j => setBotStatus(j)).catch(() => setBotStatus(null));
    fetch("/api/admin/stats", {cache: "no-store"}).then(r => r.json()).then(j => setStats(j.counts || [])).catch(() => setStats([]));
    fetch("/api/telegram/link", {cache: "no-store"}).then(r => r.json()).then(j => setLink(j.linked ? `مرتبط (${j.telegram_user_id})` : "غير مربوط")).catch(() => setLink("—"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/users", {cache: "no-store"}).then(r => r.json()).then(j => setLinks((j.users || []).filter((u: Row) => u.telegram_user_id))).catch(() => setLinks([]));
  }, []);

  const createLink = async () => {
    setNotice("");
    const res = await fetch("/api/telegram/link", {method: "POST", headers: WRITE_HEADERS});
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.deepLink) { setNotice(`🔗 افتح هذا الرابط في Telegram لربط حسابك (صالح 10 دقائق، لمرة واحدة): ${j.deepLink}`); }
    else setNotice(j.error || "تعذر إنشاء رابط الربط (البوت غير مهيأ؟)");
  };
  const unlink = async () => {
    await fetch("/api/telegram/link", {method: "DELETE", headers: WRITE_HEADERS});
    setNotice("تم إلغاء الربط.");
    load();
  };
  const configureWebhook = async () => {
    setHookBusy(true); setNotice("");
    try {
      const res = await fetch("/api/telegram/admin", {method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({action: "configure-webhook"})});
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.ok) setNotice(`✅ تم ربط Telegram بالموقع الرسمي (${result.webhookHost}). التحديثات المعلقة: ${result.pendingUpdates ?? 0}.`);
      else setNotice(`⚠️ تعذر تفعيل الربط: ${result.error || "تحقق من الإعدادات وحاول مجددًا"}`);
      load();
    } catch { setNotice("⚠️ تعذر الاتصال بالخادم، تحقق من الشبكة ثم أعد المحاولة."); }
    finally { setHookBusy(false); }
  };

  return <>
    <div className="panel"><div className="panel-heading"><h2>حالة البوت</h2></div><div className="panel-body">
      <div className="stats">
        {stats?.filter(s => String(s.table).startsWith("tg_") || String(s.table).startsWith("portal_telegram")).map(s =>
          <div className="stat" key={String(s.table)}><SendIcon/><span>{String(s.table)}</span><strong>{String(s.count)}</strong></div>)}
      </div>
      <p className="subtle small">حالة البوت: <Status tone={botStatus?.enabled ? "success" : "muted"}>{botStatus?.enabled ? "مفعّل ✅" : "غير مفعّل أو لم يُتحقق منه"}</Status></p>
      <p className="subtle small">عنوان Webhook: {botStatus?.webhook?.host || "غير محدد"} {botStatus?.webhook?.pending ? `— بانتظار المعالجة: ${botStatus.webhook.pending}` : ""}</p>
      <p className="subtle small">يربط زر التفعيل Telegram بعنوان Production الرسمي ولا يغيّر أي بيانات للمستخدمين.</p>
    {notice && <p className="note" role="status">{notice}</p>}
      <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
        <button className="action-button" onClick={configureWebhook} disabled={hookBusy}><Link2 size={15}/> {hookBusy ? "جارٍ تفعيل الربط..." : "تفعيل Webhook على الموقع الرسمي"}</button>
        <button className="action-button secondary" onClick={createLink}><Link2 size={15}/> ربط حساب Telegram</button>
        <button className="action-button secondary" onClick={unlink}><Unlink size={15}/> إلغاء Rabط</button>
      </div>
      <p className="subtle small" style={{marginTop: 8}}>حسابك الحالي: {link}</p>
    </div></div>
    <div className="panel"><div className="panel-heading"><h2>الحسابات المرتبطة بـTelegram</h2></div><div className="panel-body">
      {links === null ? <Empty description="…"/> : links.length ? <div className="stack">{links.map(l => <div className="list-row" key={String(l.id)}>
        <div className="grow"><strong>{String(l.email)}</strong><p className="subtle small">telegram_user_id: {String(l.telegram_user_id)}</p></div>
      </div>)}</div> : <Empty description="لا توجد روابط نشطة."/>}
    </div></div>
  </>;
}

function SendIcon(){ return <Send size={21}/>; }

// ---------- account section: telegram link for any logged-in publisher ----------
export function AccountPanel() {
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/telegram/link", {cache: "no-store"}).then(r => r.json()).then(j => setLink(j.linked ? `مرتبط (${j.telegram_user_id})` : "غير مربوط")).catch(() => setLink("—"));
  }, []);
  const create = async () => {
    const res = await fetch("/api/telegram/link", {method: "POST", headers: WRITE_HEADERS});
    const j = await res.json().catch(() => ({}));
    setNotice(res.ok && j.deepLink ? `افتح في Telegram: ${j.deepLink}` : (j.error || "تعذر"));
  };
  return <div className="panel"><div className="panel-heading"><h2>حسابي</h2></div><div className="panel-body">
    <p className="subtle small">Telegram: {link}</p>
    {notice && <p className="note" role="status">{notice}</p>}
    <button className="action-button secondary" onClick={create}><Link2 size={15}/> ربط حساب Telegram</button>
  </div></div>;
}

// ---------- super admin: سجل الأحداث (audit log) ----------
export function AuditTab() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/admin/audit?limit=200", {cache: "no-store"}).then(r => r.json()).then(j => setRows(j.rows || [])).catch(() => setErr("تعذر تحميل السجل"));
  }, []);
  return <div className="panel"><div className="panel-heading"><h2>سجل الأحداث</h2></div><div className="panel-body">
    {err && <p className="note" role="alert">{err}</p>}
    {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map(r => <div className="list-row" key={String(r.id)}>
      <div className="grow"><strong>{String(r.action)}</strong><p className="subtle small">{String(r.actor)} · {new Date(String(r.created_at)).toLocaleString("ar-IQ")}</p>
      {r.detail ? <p className="subtle small" dir="ltr" style={{direction:"ltr", textAlign:"right"}}>{JSON.stringify(r.detail)}</p> : null}</div>
    </div>)}</div> : <Empty description="لا توجد أحداث بعد."/>}
  </div></div>;
}
