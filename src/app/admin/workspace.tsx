"use client";
import React,{useCallback,useEffect,useState} from "react";
import {BookOpen,ClipboardList,FileQuestion,Megaphone,Paperclip,Plus,Send,Trash2,Users,Link2,Unlink} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";
import {upload} from "@vercel/blob/client";

type Me = {authenticated: boolean; email?: string; role?: string; name?: string; assigned_section?: string | null; assigned_subjects?: string[] | null};
type Row = Record<string, unknown>;
const WRITE_HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

// ---------- role-specific workspace (representatives & teachers) ----------
export function RoleWorkspace({me}: {me: Me}) {
  const isRep = me.role === "section_representative" || me.role === "general_representative";
  const isTeacher = me.role === "teacher";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [number, setNumber] = useState("1");
  const [fileUrl, setFileUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [subjects, setSubjects] = useState<Row[]>([]);
  const [audience, setAudience] = useState<"own" | "all">("own");
  useEffect(() => {
    fetch("/api/public/content?type=subjects", {cache: "no-store"}).then(r => r.json()).then(j => setSubjects(j.content?.subjects || [])).catch(() => setSubjects([]));
  }, []);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"ann" | "mat">(isRep ? "ann" : "mat");

  const type = kind === "ann" ? "announcements" : "lectures";
  const load = useCallback(() => {
    fetch(`/api/admin/content?type=${type}`, {cache: "no-store"}).then(r => r.json()).then(j => setRows(j.rows || [])).catch(() => setRows([]));
  }, [type]);
  useEffect(() => { load(); }, [load]);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setNotice("");
    try {
      let url = fileUrl;
      if (kind === "mat" && file) {
        // direct-to-Blob upload: bypasses the 4.5MB function limit; the route validates role/subject/type/size
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/admin/upload",
          contentType: "application/pdf",
          clientPayload: JSON.stringify({filename: file.name, contentType: "application/pdf", size: file.size, subjectId}),
        });
        url = blob.url;
      }
      if (kind === "mat" && !url) { setNotice("⚠️ اختر ملف PDF أو أدخل رابطًا"); setBusy(false); return; }
      const sections = audience === "all" ? ["A", "B", "C", "F"] : [me.assigned_section || "A"];
      const row = isRep && kind === "ann"
        ? {id: `web-${Date.now()}`, title, body, scope: me.role === "section_representative" ? "section" : "general", section: me.role === "section_representative" ? me.assigned_section : "all", priority: "normal", published_at: new Date().toISOString(), pinned: "false"}
        : {id: `web-${Date.now()}`, subject_id: subjectId, number: Number(number) || 1, title, description: body, file_url: url, file_name: (file?.name || url.split("/").pop() || ""), sections, status: "published", updated_at: new Date().toISOString().slice(0, 10)};
      const res = await fetch("/api/admin/content", {method: "POST", headers: WRITE_HEADERS, body: JSON.stringify({type, row})});
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(j.error || "فشل النشر"); return; }
      setNotice("✅ تم النشر بنجاح وسيصل إشعار Telegram للمشتركين عند تفعيل الخدمة");
      setTitle(""); setBody(""); setFileUrl("");
      load();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("حذف هذا المحتوى؟")) return;
    await fetch(`/api/admin/content?type=${type}&id=${encodeURIComponent(id)}`, {method: "DELETE", headers: WRITE_HEADERS});
    load();
  };

  return <>
    <PageHeading title={kind === "ann" ? "نشر تبليغ" : "نشر محاضرة / ملزمة"} description={`${me.name || me.email} · ${me.role}${me.assigned_section ? ` · الشعبة ${me.assigned_section}` : ""}${me.assigned_subjects?.length ? ` · المواد: ${me.assigned_subjects.join("، ")}` : ""}`}/>
    {notice && <p className="note" role="status">{notice}</p>}
    {isRep && <div className="tabs admin-tabs" style={{marginBottom: 14}}>
      <button className={kind === "ann" ? "selected" : ""} onClick={() => setKind("ann")}>📢 تبليغ</button>
      <button className={kind === "mat" ? "selected" : ""} onClick={() => setKind("mat")}>📚 محاضرة / ملزمة</button>
    </div>}
    <div className="panel"><div className="panel-body">
      <form className="admin-form" onSubmit={publish}>
        {kind === "mat" && <>
          <label className="form-field"><span>المادة *</span>
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)} required>
              <option value="">— اختر المادة —</option>
              {(isTeacher ? (me.assigned_subjects || []).map(s => ({id: s, name: s})) : subjects.map(s => ({id: String(s.id), name: String(s.name)}))).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="form-field"><span>رقم المحاضرة/الملزمة</span><input type="number" min={1} value={number} onChange={e => setNumber(e.target.value)}/></label>
          {isRep && <label className="form-field"><span>الجمهور *</span>
            <select value={audience} onChange={e => setAudience(e.target.value as "own" | "all")}>
              <option value="own">📌 شعبتي ({me.assigned_section})</option>
              <option value="all">🌐 جميع الشعب (A, B, C, F)</option>
            </select></label>}
        </>}
        <label className="form-field wide"><span>العنوان *</span><input value={title} onChange={e => setTitle(e.target.value)} required/></label>
        <label className="form-field wide"><span>{isRep ? "نص التبليغ" : "الوصف"}</span><textarea rows={4} value={body} onChange={e => setBody(e.target.value)}/></label>
        {kind === "mat" && <>
          <label className="form-field wide"><span>ملف PDF (رفع من الجهاز)</span><input type="file" accept="application/pdf,.pdf" onChange={e => { setFile(e.target.files?.[0] || null); setFileUrl(""); }}/></label>
          <label className="form-field wide"><span>…أو رابط ملف محفوظ</span><input dir="ltr" placeholder="https://…pdf" value={fileUrl} onChange={e => { setFileUrl(e.target.value); setFile(null); }}/></label>
        </>}
        <button className="action-button" style={{gridColumn: "1/-1", justifySelf: "start"}} disabled={busy}><Send size={15}/> {busy ? "جارٍ النشر…" : "نشر الآن"}</button>
      </form>
    </div></div>
    <div className="panel"><div className="panel-heading"><h2>{kind === "ann" ? "تبليغاتي" : "موادي المنشورة"}</h2></div><div className="panel-body">
      {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map((r, i) => <div className="list-row" key={String(r.id || i)}>
        <div className="grow"><strong>{String(r.title || r.id)}</strong><p className="subtle small">{String(r.section || r.subject_id || "")}</p></div>
        <button className="action-button secondary" title="حذف" onClick={() => remove(String(r.id))}><Trash2 size={14}/></button>
      </div>)}</div> : <Empty description="لا يوجد محتوى بعد."/>}
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
  const [form, setForm] = useState({email: "", name: "", role: "section_representative", assigned_section: "A", assigned_subjects: ""});
  const [busy, setBusy] = useState(false);

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
    })});
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNotice(j.error || "فشل إنشاء الدعوة"); return; }
    setNotice(`✅ تم إنشاء الدعوة. رابط التفعيل (مرة واحدة): ${j.setupUrl}`);
    setForm({email: "", name: "", role: "section_representative", assigned_section: "A", assigned_subjects: ""});
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
        <div className="grow"><strong>{String(u.name || u.email)}</strong><p className="subtle small">{String(u.email)} · {String(u.role)} · {String(u.assigned_section || "")} {u.telegram_user_id ? "· 🔗 Telegram" : ""}</p></div>
        <Status tone={u.status === "suspended" ? "danger" : "success"}>{String(u.status || "active")}</Status>
        {u.status !== "suspended"
          ? <button className="action-button secondary" onClick={() => setStatus(Number(u.id), "suspended")}>تعليق</button>
          : <button className="action-button secondary" onClick={() => setStatus(Number(u.id), "active")}>تفعيل</button>}
      </div>)}</div> : <Empty description="لا توجد حسابات بعد."/>}
    </div></div>

    <div className="panel"><div className="panel-heading"><h2>الدعوات</h2></div><div className="panel-body">
      {invitations === null ? <Empty description="…"/> : invitations.length ? <div className="stack">{invitations.map(v => <div className="list-row" key={String(v.id)}>
        <div className="grow"><strong>{String(v.email)}</strong><p className="subtle small">{String(v.role)} · {String(v.assigned_section || "")} · تنتهي ${new Date(String(v.expires_at)).toLocaleString("ar-IQ")}</p></div>
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

  const load = useCallback(() => {
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

  return <>
    <div className="panel"><div className="panel-heading"><h2>حالة البوت</h2></div><div className="panel-body">
      <div className="stats">
        {stats?.filter(s => String(s.table).startsWith("tg_") || String(s.table).startsWith("portal_telegram")).map(s =>
          <div className="stat" key={String(s.table)}><SendIcon/><span>{String(s.table)}</span><strong>{String(s.count)}</strong></div>)}
      </div>
      <p className="subtle small">الحالة: <Status tone="muted">معطّل (TELEGRAM_BOT_ENABLED=false)</Status> — الإشعارات لا تُرسل حتى التفعيل الصريح.</p>
      {notice && <p className="note" role="status">{notice}</p>}
      <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
        <button className="action-button" onClick={createLink}><Link2 size={15}/> ربط حساب Telegram</button>
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
