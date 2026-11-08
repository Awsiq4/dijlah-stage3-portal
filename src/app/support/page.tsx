"use client";

import {useEffect, useState} from "react";
import "./support.css";

type TicketRow = {
  id: number; subject: string; category: string; status: string;
  priority: string; section: string | null; created_at: string;
  first_name?: string; last_name?: string; username?: string; assigned_to?: number | null;
  telegram_id?: string | number | null; reg_seq?: number | null; section_from_telegram?: string | null;
  last_sender_type?: "student" | "admin" | null;
  inbox_group?: "pending" | "waiting" | "done"; effective_section?: string | null; has_unread?: boolean;
};
type VerifiedStudent = {
  verified: true; telegram_id: string; first_name: string | null; last_name: string | null;
  username: string | null; reg_seq: number | null; section: string | null;
  role: string | null; status: string | null; registered_at: string | null;
};
type TicketDetail = {
  ticket: TicketRow;
  studentProfile?: VerifiedStudent | null;
  messages: {id: number; sender_type: "student" | "admin" | "internal"; body: string; internal: boolean; created_at: string}[];
  attachments: {id: string; message_id: number; name: string}[];
  history: {action: string; actor: string; created_at: string}[];
};
type Stats = {
  summary: Record<string, number | null>;
  groups: Record<string, {label: string; count: number}[]>;
  daily: {day: string; count: number}[];
  common: {subject: string; count: number}[];
};
type Member = {id: number; name: string; permissions: string[]};
type View = "main" | "ticket" | "stats" | "team";
const categories: Record<string,string> = {
  support: "تواصل مع الدعم",
  idea: "اقترح فكرة",
  problem: "بلّغ عن مشكلة",
};
const statuses: Record<string,string> = {
  new: "جديد",
  awaiting: "بانتظار ردك",
  progress: "قيد المعالجة",
  resolved: "تم الحل",
  closed: "مغلق",
};
const priorities: Record<string,string> = {normal: "عادي", important: "مهم", urgent: "عاجل"};
const metricNames: Record<string,string> = {
  total: "كل الطلبات", today: "اليوم", days7: "آخر 7 أيام",
  days30: "آخر 30 يومًا", open: "المفتوحة",
  unanswered: "بانتظار أول رد", reopened: "أُعيد فتحها",
  first_response_minutes: "دقائق حتى أول رد",
  resolution_minutes: "دقائق حتى الحل",
};
const shortDate = (value: string) => new Date(value).toLocaleString("ar-IQ", {timeZone: "Asia/Baghdad", dateStyle: "medium",timeStyle: "short"});
function statusLabel(status: string, isStaff: boolean, last?: "student" | "admin" | null) {
  if (status === "closed" || status === "resolved") return statuses[status];
  if (last === "admin") return isStaff ? "بانتظار الطالب" : "ردّت الإدارة";
  if (last === "student") return isStaff ? "ردّ الطالب" : "بانتظار الإدارة";
  return statuses[status] || status;
}

export default function SupportPage() {
  const [view, setView] = useState<View>("main");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [inbox,setInbox] = useState<"pending" | "waiting" | "done">("pending");
  const [inboxCounts,setInboxCounts] = useState({pending:0,waiting:0,done:0});
  const [attachment,setAttachment] = useState<File|null>(null);
  const [recoveryCode,setRecoveryCode] = useState("");
  const [enterCode,setEnterCode] = useState("");
  const [owner, setOwner] = useState(false);
  const [staff, setStaff] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [category, setCategory] = useState("support");
  const [message, setMessage] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyKey, setReplyKey] = useState("");
  const [internal, setInternal] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("normal");
  const [filters, setFilters] = useState({q: "", status: "", category: "", section: ""});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const can = (action: string) => owner || permissions.includes("support.manage") || permissions.includes("support." + action);

  async function api(url: string, payload?: Record<string, unknown>) {
    const response = await fetch(url, payload ? {
      method: "POST",
      headers: {"content-type": "application/json", "x-support": "1"},
      body: JSON.stringify(payload),
    } : {cache: "no-store"});
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "تعذر إكمال الطلب.");
    return json;
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر الاتصال. حاول مرة ثانية."); }
    finally { setBusy(false); }
  }

  async function load(nextPage = 0, filterInbox = inbox) {
    const params = new URLSearchParams({...filters, inbox: filterInbox, page: String(nextPage)});
    const response = await api("/api/support?" + params);
    setRows(response.rows || []);
    setTotal(Number(response.total) || 0);
    setPage(nextPage);
    setOwner(Boolean(response.owner));
    setStaff(Boolean(response.staff));
    setPermissions(response.permissions || []);
    setInboxCounts(response.inboxCounts || {pending:0,waiting:0,done:0});
    setInitialized(true);
  }

  useEffect(() => {
    setRequestKey(crypto.randomUUID());
    setReplyKey(crypto.randomUUID());
    void run(() => load(0));
  }, []);

  async function openTicket(id: number) {
    const response: TicketDetail = await api("/api/support?id=" + id);
    setDetail(response);
    setAssignedTo(response.ticket.assigned_to ? String(response.ticket.assigned_to) : "");
    setPriority(response.ticket.priority);
    if(can("assign")){
      const members:Member[]=await api("/api/support?staff=1");
      setPeople(members);
    }
    setReplyBody("");
    setInternal(false);
    setReplyKey(crypto.randomUUID());
    setView("ticket");
  }

  async function filePayload():Promise<{name:string;mime:string;base64:string}|undefined>{
    if(!attachment)return undefined;
    if(!["image/jpeg","image/png"].includes(attachment.type))throw new Error("المسموح صورة JPG أو PNG فقط.");
    if(!attachment.size||attachment.size>2*1024*1024)throw new Error("الصورة لازم تكون أقل من 2MB.");
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("تعذّر قراءة الصورة."));
      reader.onload=()=>{
        const value=String(reader.result||"");
        resolve({name:attachment.name,mime:attachment.type,base64:value.split(",")[1]||""});
      };
      reader.readAsDataURL(attachment);
    });
  }
  async function issueRecovery(){
    const result=await api("/api/support",{action:"recovery_create"});
    setRecoveryCode(result.code);
  }
  async function recover(){
    if(!enterCode.trim())throw new Error("أدخل رمز الاستعادة.");
    await api("/api/support",{action:"recovery_use",code:enterCode.trim()});
    setEnterCode("");
    setRecoveryCode("");
    setNotice("تمت استعادة طلباتك على هذا المتصفح.");
    await load(0);
  }
  async function changeInbox(next:"pending"|"waiting"|"done"){
    setInbox(next);
    await load(0,next);
  }

  async function sendTicket() {
    const body = message.trim();
    if (body.length < 3) {setError("اكتب رسالتك أولاً."); return;}
    const subject = body.replace(/\s+/g, " ").slice(0, 90);
    const key = requestKey || crypto.randomUUID();
    const file=await filePayload();
    const result = await api("/api/support", {action: "create", category, body, subject, key,...(file?{file}:{})});
    setMessage("");
    setAttachment(null);
    setRequestKey(crypto.randomUUID());
    setNotice("✅ تم إرسال طلبك. تگدر تتابع الرد هنا.");
    await load(0);
    await openTicket(Number(result.id));
  }

  async function sendReply() {
    if (!detail || !replyBody.trim()) return;
    await api("/api/support", {
      action: "reply", id: detail.ticket.id,
      body: replyBody.trim(), key: replyKey || crypto.randomUUID(),
      internal: staff && internal,
    });
    await openTicket(detail.ticket.id);
    await load(page);
  }

  async function setStatus(status: string) {
    if (!detail) return;
    await api("/api/support", {action: "status", id: detail.ticket.id, status});
    await openTicket(detail.ticket.id);
    await load(page);
  }

  async function saveAssignment() {
    if (!detail) return;
    await api("/api/support", {
      action: "assign", id: detail.ticket.id, adminId: assignedTo || null, priority,
    });
    await openTicket(detail.ticket.id);
    setNotice("تم الحفظ.");
  }

  async function saveMember(member: Member) {
    await api("/api/support", {action: "grant", adminId: member.id, permissions: member.permissions});
    setNotice("تم حفظ الصلاحيات.");
  }

  function back() {setView("main");setDetail(null);setError("");setNotice("");void run(() => load(0));}

  return <section className="support-center" dir="rtl">
    <header className="sup-heading">
      <h1>الدعم والاقتراحات</h1>
      <p>{staff ? "إدارة الطلبات والردود" : "عندك سؤال أو اقتراح؟ اكتب لنا."}</p>
    </header>

    {view !== "main" && <button className="sup-back" onClick={back} type="button">→ رجوع</button>}
    {error && <div role="alert" className="sup-error">{error}</div>}
    {!initialized && <div className="sup-empty">{busy ? "جارٍ تحميل الدعم…" : <button onClick={()=>void run(()=>load(0))}>إعادة المحاولة</button>}</div>}
    {notice && <div role="status" className="sup-success">{notice}</div>}

    {view === "main" && initialized && <>
      {!staff && <form className="sup-compose" onSubmit={event => {event.preventDefault();void run(sendTicket);}}>
        <div className="sup-category" role="group" aria-label="نوع الطلب">
          {Object.entries(categories).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={category===key}
              className={category===key ? "active" : ""}
              disabled={busy} onClick={() => setCategory(key)}>{label}</button>
          )}
        </div>
        <label className="sup-message-label" htmlFor="support-message">رسالتك</label>
        <textarea id="support-message" rows={4} required minLength={3} maxLength={3000}
          value={message} disabled={busy} onChange={event => setMessage(event.target.value)}
          placeholder="اكتب رسالتك هنا..." />
        <button type="submit" className="sup-primary sup-submit" disabled={busy || message.trim().length<3}>
          {busy ? "جارٍ الإرسال..." : "إرسال الطلب"}
        </button>
      </form>}

      {staff && <div className="sup-staff-controls">
        <details className="sup-tools">
          <summary>بحث وتصفية</summary>
          <form className="sup-filters" onSubmit={event => {event.preventDefault();void run(() => load(0));}}>
            <input aria-label="بحث" placeholder="ابحث برقم الطلب أو العنوان" value={filters.q}
              onChange={event => setFilters({...filters,q:event.target.value})}/>
            <select aria-label="الحالة" value={filters.status} onChange={event => setFilters({...filters,status:event.target.value})}>
              <option value="">كل الحالات</option>
              {Object.entries(statuses).map(([key,value])=><option value={key} key={key}>{value}</option>)}
            </select>
            <select aria-label="النوع" value={filters.category} onChange={event => setFilters({...filters,category:event.target.value})}>
              <option value="">كل الأنواع</option>
              {Object.entries(categories).map(([key,value])=><option value={key} key={key}>{value}</option>)}
            </select>
            <select aria-label="الشعبة" value={filters.section} onChange={event => setFilters({...filters,section:event.target.value})}>
              <option value="">كل الشعب</option>
              {["A","B","C","F"].map(key=><option key={key}>{key}</option>)}
            </select>
            <button type="submit" disabled={busy}>تطبيق</button>
          </form>
        </details>
        {owner && <>
          <button type="button" onClick={() => void run(async () => {setStats(await api("/api/support?stats=1"));setView("stats");})}>الإحصائيات</button>
          <button type="button" onClick={() => void run(async () => {setPeople(await api("/api/support?staff=1"));setView("team");})}>الفريق</button>
        </>}
      </div>}

      <div className="sup-requests">
        <div className="sup-requests-header">
          <h2>{staff ? "طلبات الطلاب" : "طلباتي"}</h2>
          <span>{total}</span>
        </div>
        {!busy && rows.length===0 && <p className="sup-empty">ماكو طلبات حالياً.</p>}
        <div className="sup-list">
          {rows.map(ticket => <button type="button" className="sup-ticket" key={ticket.id}
            onClick={() => void run(() => openTicket(ticket.id))}>
            <span>
              <strong>{ticket.subject}</strong>
              <small>#{String(ticket.id).padStart(6,"0")} · {shortDate(ticket.created_at)}</small>
              {staff && <small>👤 {ticket.first_name
                ? [ticket.first_name,ticket.last_name].filter(Boolean).join(" ")
                : ticket.telegram_id ? "حساب Telegram مرتبط" : "زائر غير معروف"}
                {ticket.section || ticket.section_from_telegram ? " · شعبة " + (ticket.section || ticket.section_from_telegram) : ""}</small>}
            </span>
            <span className={"sup-status " + (ticket.last_sender_type === "admin" ? "answered" : ticket.status)}>
              {statusLabel(ticket.status, staff, ticket.last_sender_type)}
            </span>
          </button>)}
        </div>
        {total > 10 && <div className="sup-pagination">
          <button disabled={busy || page===0} onClick={() => void run(()=>load(page-1))}>السابق</button>
          <span>{page + 1}</span>
          <button disabled={busy || (page+1)*10>=total} onClick={() => void run(()=>load(page+1))}>التالي</button>
        </div>}
      </div>
      {!staff && <p className="sup-hint">الردود تظهر هنا من نفس المتصفح. احتفظ ببيانات متصفحك حتى تگدر ترجع لطلباتك.</p>}
    </>}

    {view === "ticket" && detail && <div className="sup-detail">
      <header className="sup-detail-title">
        <div><small>#{String(detail.ticket.id).padStart(6,"0")}</small><h2>{detail.ticket.subject}</h2></div>
        <span className={"sup-status " + (detail.messages.at(-1)?.sender_type === "admin" ? "answered" : detail.ticket.status)}>
          {statusLabel(detail.ticket.status, staff,
            detail.messages.filter(item => !item.internal).at(-1)?.sender_type as "student" | "admin" | undefined)}
        </span>
      </header>
      {staff && <aside className="sup-student-card">
        <strong>👤 معلومات صاحب الطلب</strong>
        {detail.studentProfile?.verified ? <>
          <div className="sup-student-fields">
            <span>الاسم: <b>{[detail.studentProfile.first_name,detail.studentProfile.last_name].filter(Boolean).join(" ") || "غير متوفر"}</b></span>
            <span>Telegram: <b dir="ltr">{detail.studentProfile.username ? "@"+detail.studentProfile.username : "بدون يوزر"}</b></span>
            <span>Telegram ID: <b dir="ltr">{detail.studentProfile.telegram_id}</b></span>
            <span>رقم التسجيل: <b>{detail.studentProfile.reg_seq ? "#"+String(detail.studentProfile.reg_seq).padStart(6,"0") : "غير متوفر"}</b></span>
            <span>الشعبة: <b>{detail.studentProfile.section ? "شعبة "+detail.studentProfile.section : "غير محددة"}</b></span>
            <span>الدور: <b>{detail.studentProfile.role === "student" ? "طالب" : detail.studentProfile.role || "غير محدد"}</b></span>
          </div>
          <small>✓ حساب Telegram مرتبط مسبقاً ومتحقق منه. ما احتاج الطالب يربطه مرة ثانية.</small>
        </> : <p className="sup-no-profile">زائر موقع — ماكو حساب Telegram موثّق مرتبط بهذا الطلب.</p>}
      </aside>}
      <div className="sup-thread" aria-label="محادثة طلب الدعم">
        {detail.messages.map((entry,index) => <article key={entry.id} className={"sup-bubble " + entry.sender_type}>
          <div className="sup-message-heading">
            <strong>{entry.sender_type === "internal" ? "🔒 ملاحظة داخلية" :
              entry.sender_type === "admin" ? "✅ رد الإدارة" : index === 0 ? "📝 طلب الطالب" : "💬 رد الطالب"}</strong>
            <small>{shortDate(entry.created_at)}</small>
          </div>
          <p>{entry.body}</p>
          {detail.attachments.filter(file=>file.message_id===entry.id).map(file=>
            <a key={file.id} href={"/api/support?file="+encodeURIComponent(file.id)}>📎 {file.name}</a>)}
        </article>)}
      </div>
      {detail.ticket.status!=="closed" &&
        <form className="sup-reply" onSubmit={event=>{event.preventDefault();void run(sendReply);}}>
          <textarea rows={3} required maxLength={3000} placeholder="اكتب ردك..." value={replyBody}
            onChange={event=>setReplyBody(event.target.value)} disabled={busy}/>
          {can("reply") && <label className="sup-inline-check">
            <input type="checkbox" checked={internal} onChange={event=>setInternal(event.target.checked)}/>
            ملاحظة داخلية
          </label>}
          <button type="submit" className="sup-primary" disabled={busy||!replyBody.trim()}>إرسال الرد</button>
        </form>}
      <div className="sup-detail-actions">
        {can("close")
          ? <select aria-label="حالة الطلب" value={detail.ticket.status} disabled={busy}
              onChange={event=>void run(()=>setStatus(event.target.value))}>
              {Object.entries(statuses).map(([value,label])=><option value={value} key={value}>{label}</option>)}
            </select>
          : <button type="button" disabled={busy} onClick={()=>void run(()=>setStatus(["closed","resolved"].includes(detail.ticket.status)?"progress":"closed"))}>
              {["closed","resolved"].includes(detail.ticket.status)?"إعادة فتح":"إغلاق الطلب"}
            </button>}
        <button type="button" onClick={()=>void run(()=>openTicket(detail.ticket.id))} disabled={busy}>تحديث</button>
      </div>
      {can("assign") && <details className="sup-tools">
        <summary>إعدادات الطلب</summary>
        <div className="sup-admin-extra">
          <select aria-label="موظف الدعم" value={assignedTo} onChange={event=>setAssignedTo(event.target.value)}>
            <option value="">غير مسند</option>
            {people.filter(person=>person.permissions?.some(p=>["support.reply","support.manage"].includes(p)))
              .map(person=><option key={person.id} value={person.id}>{person.name || person.id}</option>)}
          </select>
          <select aria-label="الأولوية" value={priority} onChange={event=>setPriority(event.target.value)}>
            {Object.entries(priorities).map(([value,label])=><option value={value} key={value}>{label}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={()=>void run(saveAssignment)}>حفظ</button>
        </div>
      </details>}
      {staff && detail.history.length>0 && <details className="sup-tools">
        <summary>سجل الإجراءات</summary>
        {detail.history.map((entry,index)=><p key={index}>{entry.action} · {shortDate(entry.created_at)}</p>)}
      </details>}
    </div>}

    {view === "stats" && stats && owner && <div className="sup-analytics">
      <h2>إحصائيات الدعم</h2>
      <div className="sup-stats-grid">
        {Object.entries(stats.summary).map(([key,value])=><div key={key}>
          <strong>{value ?? "—"}</strong><span>{metricNames[key] || key}</span>
        </div>)}
      </div>
      <details className="sup-tools"><summary>التفاصيل حسب النوع والشعبة والحالة</summary>
        {Object.entries(stats.groups).map(([key,values])=><section key={key}>
          <h3>{({section:"الشعبة",category:"النوع",priority:"الأولوية",status:"الحالة",assigned_to:"الفريق"} as Record<string,string>)[key] || key}</h3>
          {values.map((entry,index)=><p key={index}>{categories[entry.label] || statuses[entry.label] || priorities[entry.label] || entry.label || "غير محدد"}: {entry.count}</p>)}
        </section>)}
      </details>
    </div>}

    {view === "team" && owner && <div className="sup-team">
      <h2>فريق الدعم</h2>
      {people.map(member=><div className="sup-member" key={member.id}>
        <strong>{member.name || member.id}</strong>
        <div className="sup-member-perms">
          {(["view","reply","assign","close","manage"] as const).map(kind=><label key={kind}>
            <input type="checkbox" checked={member.permissions?.includes("support."+kind)||false}
              onChange={event=>setPeople(people.map(person=>
                person.id===member.id
                  ? {...person,permissions:event.target.checked
                      ? [...(person.permissions||[]),"support."+kind]
                      : (person.permissions||[]).filter(p=>p!=="support."+kind)}
                  : person
              ))}/>
            {({view:"عرض",reply:"رد",assign:"إسناد",close:"إغلاق",manage:"إدارة"} as const)[kind]}
          </label>)}
        </div>
        <button disabled={busy} onClick={()=>void run(()=>saveMember(member))}>حفظ</button>
      </div>)}
    </div>}
  </section>;
}
