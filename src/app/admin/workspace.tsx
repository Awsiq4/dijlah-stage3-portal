"use client";
import {TELEGRAM_STAFF_ROLES} from "@/lib/telegram-roles";
import React,{useCallback,useEffect,useRef,useState} from "react";
import {Plus,Send,Users,Link2,Unlink,Layers,Ellipsis,LogOut,X,KeyRound} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";
import {usePublicationRequest} from "./publication-review";
import {MaterialForm, type PublishingAccount} from "./material-form";
import {AssignmentForm} from "./assignment-form";
import {ExamForm} from "./exam-form";
import {CONTENT_SECTIONS, AdminNavGroup, ContentList, useAdminRows, type PublicationType} from "./content-navigation";

type Me = PublishingAccount & {authenticated: boolean; email?: string; name?: string};
type Row = Record<string, unknown>;
const WRITE_HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

export function RoleWorkspace({me, subjects, passkeyLink, onLogout}: {
  me: Me;
  subjects: Row[];
  passkeyLink: React.ReactNode;
  onLogout: () => Promise<void>;
}) {
  const {request, review} = usePublicationRequest();
  const teacher = me.role === "teacher";
  const canPublish = TELEGRAM_STAFF_ROLES.includes(me.role || "");
  const sections = CONTENT_SECTIONS;
  const [type, setType] = useState<PublicationType>("lectures");
  const [more, setMore] = useState(!canPublish);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const {rows, failed, reload} = useAdminRows(!more && canPublish ? type : null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [audience, setAudience] = useState("");
  const teachingSubjects = subjects.filter(item => me.assigned_subjects?.includes(String(item.id)));
  const allowedSections = me.perms?.teacher_sections?.[subject] ?? ["A", "B", "C", "F"];
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const draftId = useRef("");

  function changeSection(next: PublicationType, draft: Row | null = null) {
    setType(next);
    setMore(false);
    setPublishing(false);
    setNotice("");
    setEditing(draft);
    draftId.current = "";
    setTitle(String(draft?.title || ""));
    setSubject(String(draft?.subject_id || (teachingSubjects.length === 1 ? teachingSubjects[0].id : "")));
    setAudience(String(draft?.section || ""));
    setBody(String(draft?.body || ""));
  }

  function saved() {
    setEditing(null);
    setNotice("تم الحفظ بنجاح.");
    reload();
  }

  async function publishAnnouncement(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim() || busy) return;
    if (teacher && (!teachingSubjects.some(item => item.id === subject) || !audience ||
        (audience === "all" ? allowedSections.length !== 4 : !allowedSections.includes(audience)))) {
      setNotice("اختر المادة والشعبة المتاحة للنشر.");
      return;
    }
    setBusy(true);
    setNotice("");
    const ownSection = me.role === "section_representative";
    if (!draftId.current) draftId.current = `web-${crypto.randomUUID()}`;
    const row = {
      id: editing?.id || draftId.current, title: title.trim(), body: body.trim(),
      scope: teacher ? "teacher" : editing?.scope || (ownSection ? "section" : "general"),
      section: teacher ? audience : editing?.section || (ownSection ? me.assigned_section : "all"),
      subject_id: teacher ? subject : editing?.subject_id, priority: editing?.priority || "normal",
      published_at: editing?.published_at || new Date().toISOString(), pinned: editing?.pinned ?? false,
    };
    try {
      const {response, data} = await request("announcements", row, {editing: Boolean(editing?.id), subject: String(teachingSubjects.find(item => item.id === subject)?.name || "")});
      if (data.cancelled) return;
      if (!response.ok) { setNotice(data.error || "تعذّر حفظ التبليغ."); return; }
      saved();
    } catch { setNotice("تعذّر حفظ التبليغ. حاول مرة ثانية."); }
    finally { setBusy(false); }
  }

  async function remove(row: Row) {
    if (!confirm("حذف هذا المحتوى نهائيًا؟")) return;
    try {
      const response = await fetch(`/api/admin/content?type=${type}&id=${encodeURIComponent(String(row.id))}`, {method: "DELETE", headers: WRITE_HEADERS});
      if (!response.ok) throw new Error("Delete failed");
      setNotice("تم الحذف.");
      reload();
    } catch { setNotice("تعذّر حذف المحتوى."); }
  }

  const current = sections.find(item => item.id === type);
  const initial = editing?.id ? editing : undefined;
  return <div className="admin-shell admin-workspace-layout">
    <nav className="admin-desktop-nav" aria-label="أقسام الإدارة">
      {canPublish && <AdminNavGroup label="المحتوى" items={sections} active={more ? "" : type} onSelect={id => changeSection(id)}/>}
      <AdminNavGroup label="الإعدادات" items={[{id: "account", label: "حسابي وأمان الدخول", Icon: KeyRound}]} active={more ? "account" : ""}
        onSelect={() => {changeSection(type); setMore(true);}}/>
      <button type="button" className="admin-side-logout" onClick={onLogout}><LogOut size={17}/> تسجيل الخروج</button>
    </nav>
    <div className="admin-workspace-main">
    {review}
    <PageHeading title="لوحة الإدارة" description={me.name || me.email} action={canPublish &&
      <button type="button" className="action-button admin-publish" aria-expanded={publishing} onClick={() => setPublishing(value => !value)}><Plus size={18}/> نشر</button>}/>
    {publishing && <section className="panel">
      <div className="panel-heading"><h2>شنو تريد تنشر؟</h2></div>
      <div className="panel-body admin-option-grid">{sections.map(({id, addLabel, Icon}) =>
        <button type="button" key={id} className="admin-option" onClick={() => changeSection(id, {})}><Icon size={18}/>{addLabel}</button>)}</div>
    </section>}
    <nav className="admin-primary-nav" aria-label="أقسام الإدارة">
      {canPublish && <button type="button" aria-current={!more ? "page" : undefined} onClick={() => changeSection(type)}><Layers size={19}/> المحتوى</button>}
      <button type="button" aria-current={more ? "page" : undefined} onClick={() => {changeSection(type); setMore(true);}}><Ellipsis size={19}/> حسابي</button>
    </nav>
    {more ? <>
      <AccountPanel/>
      <section className="panel">
        <div className="panel-heading"><h2>أمان الدخول</h2></div>
        <div className="panel-body admin-actions">{passkeyLink}<button type="button" className="action-button secondary" onClick={onLogout}><LogOut size={19}/> تسجيل الخروج</button></div>
      </section>
    </> : canPublish && <>
      <div className="tabs admin-tabs admin-mobile-only" aria-label="نوع المحتوى">
        {sections.map(({id, label}) => <button type="button" key={id} aria-pressed={id === type} className={id === type ? "selected" : ""} onClick={() => changeSection(id)}>{label}</button>)}
      </div>
      {notice && <p className="note" role="status">{notice}</p>}
      <div className={"admin-content-layout" + (editing ? " admin-is-editing" : "")}>
        <section className="panel admin-list-pane">
          <div className="panel-heading"><h2>{current?.label}</h2>
            <button type="button" className="action-button" onClick={() => changeSection(type, {})}><Plus size={16}/> إضافة</button>
          </div>
          <div className="panel-body">
            {failed ? <Empty title="تعذّر تحميل المحتوى" description="حاول فتح القسم مجدداً."/> : rows ?
              <ContentList key={type} onChanged={reload} kind={type} rows={type === "exams" ? rows.filter(row => row.type === "كوز يومي") : rows} subjects={subjects}
                selected={initial?.id ? String(initial.id) : undefined} onEdit={row => changeSection(type, row)} onRemove={row => {
                  if (row.id === initial?.id) setNotice("أغلق نموذج التعديل قبل حذف هذا المنشور.");
                  else void remove(row);
                }}/> :
              <p className="subtle" role="status">جارٍ تحميل المحتوى…</p>}
          </div>
        </section>
        {editing && <section className="panel admin-editor-pane" aria-label={initial ? "تعديل المنشور" : "إضافة منشور"}>
          <div className="panel-heading">
            <h2>{initial ? "تعديل" : "إضافة"} · {current?.label}</h2>
            <button type="button" className="action-button secondary" disabled={busy} onClick={() => changeSection(type)}><X size={16}/> إغلاق</button>
          </div>
          <div className="panel-body">
          {type === "lectures" ? <MaterialForm key={String(initial?.id || "new")} account={me} initial={initial} rows={rows || []} onSaved={reload}/> :
            type === "assignments" ? <AssignmentForm key={String(initial?.id || "new")} account={me} initial={initial} onSaved={saved}/> :
            type === "exams" ? <ExamForm key={String(initial?.id || "new")} account={me} initial={initial} onSaved={saved}/> :
            <form className="admin-form" onSubmit={publishAnnouncement}>
              {teacher && <>
                <label className="form-field"><span>المادة</span><select required value={subject} onChange={event => {setSubject(event.target.value); setAudience("");}}>
                  <option value="">اختر المادة</option>
                  {teachingSubjects.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}
                </select></label>
                <label className="form-field"><span>الشعبة</span><select required value={audience} disabled={!subject} onChange={event => setAudience(event.target.value)}>
                  <option value="">اختر الشعبة</option>
                  {allowedSections.length === 4 && <option value="all">كل الشعب</option>}
                  {allowedSections.map(section => <option key={section} value={section}>{section}</option>)}
                </select></label>
              </>}
              <label className="form-field wide"><span>العنوان</span><input required value={title} onChange={e => setTitle(e.target.value)}/></label>
              <label className="form-field wide"><span>نص التبليغ</span><textarea required rows={4} value={body} onChange={e => setBody(e.target.value)}/></label>
              <button className="action-button" disabled={busy}><Send size={15}/> {busy ? "جارٍ الحفظ…" : initial ? "حفظ التعديلات" : "نشر التبليغ"}</button>
            </form>}
          </div>
        </section>}
      </div>
    </>}
    </div>
  </div>;
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
    const delivery = j.telegramNotification === "sent"
      ? "📨 وصل إشعار الدعوة إلى Telegram."
      : j.telegramNotification === "start_required"
        ? "⚠️ لم يصل إشعار Telegram بعد؛ لازم المستخدم يفتح البوت ويضغط Start أولاً."
        : j.telegramNotification === "not_configured"
          ? "⚠️ بوت Telegram غير مهيأ للإشعارات حالياً."
          : "لم يُحدّد Telegram ID.";
    setNotice(`✅ تم إنشاء الدعوة. رابط التفعيل (مرة واحدة): ${j.setupUrl}\n${delivery}${j.telegramStartUrl?"\nرابط فتح البوت: "+j.telegramStartUrl:""}`);
    setForm({email: "", name: "", role: "section_representative", assigned_section: "A", telegram_user_id: "", telegram_username: ""});
    load();
  };

  const setStatus = async (id: number, status: "active" | "suspended") => {
    if (status === "suspended" && !confirm("تعليق الحساب يسحب الجلسات وروابط Telegram فورًا — متابعة؟")) return;
    await fetch("/api/admin/users", {method: "PATCH", headers: WRITE_HEADERS, body: JSON.stringify({id, status})});
    load();
  };

  return <>
    <div className="panel"><div className="panel-heading"><h2><Plus size={18}/> دعوة تدريسي أو ممثل</h2></div><div className="panel-body">
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

    <div className="panel"><div className="panel-heading"><h2><Users size={18}/> حسابات التدريسيين والممثلين</h2></div><div className="panel-body">
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
          <div className="stat" key={String(s.table)}><SendIcon/><span>{{tg_subscribers: "المشتركون", tg_events: "أحداث الإشعارات", tg_deliveries: "عمليات الإرسال"}[String(s.table)] || "روابط تيليجرام"}</span><strong>{String(s.count)}</strong></div>)}
      </div>
      <p className="subtle small">حالة البوت: <Status tone={botStatus?.enabled ? "success" : "muted"}>{botStatus?.enabled ? "مفعّل ✅" : "غير مفعّل أو لم يُتحقق منه"}</Status></p>

    {notice && <p className="note" role="status">{notice}</p>}
      <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
        <button className="action-button secondary" onClick={createLink}><Link2 size={15}/> ربط حساب Telegram</button>
        <button className="action-button secondary" onClick={unlink}><Unlink size={15}/> إلغاء ربط الحساب</button>
      </div>
      <p className="subtle small" style={{marginTop: 8}}>حسابك الحالي: {link}</p>
      <details className="admin-diagnostics">
        <summary>التشخيص الفني للبوت</summary>
        <p className="subtle small">عنوان استقبال تحديثات البوت: {botStatus?.webhook?.host || "غير محدد"} · بانتظار المعالجة: {botStatus?.webhook?.pending ?? "—"}</p>
        <button type="button" className="action-button secondary" onClick={configureWebhook} disabled={hookBusy}><Link2 size={15}/> {hookBusy ? "جارٍ ربط البوت…" : "ربط البوت بالموقع الرسمي"}</button>
      </details>
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
  return <div className="panel"><div className="panel-heading"><h2>حسابي على تيليجرام</h2></div><div className="panel-body">
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
