"use client";
import React,{useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {BellRing,BookOpen,CalendarDays,FileQuestion,ClipboardList,Megaphone,LogOut,ShieldCheck,Database,Send} from "lucide-react";
import {Empty,PageHeading,Status} from "@/components/UI";

type Me = {authenticated: boolean; email?: string; role?: string};
type Stats = {databaseConfigured: boolean; counts?: {table: string; count: number}[]; recentAudit?: {actor: string; action: string; created_at: string}[]};

const TABS = [
  {id: "overview", label: "نظرة عامة", Icon: ShieldCheck},
  {id: "announcements", label: "التبليغات", Icon: Megaphone},
  {id: "lectures", label: "المحاضرات", Icon: BookOpen},
  {id: "exams", label: "الامتحانات", Icon: FileQuestion},
  {id: "assignments", label: "الواجبات", Icon: ClipboardList},
  {id: "schedule", label: "الجدول", Icon: CalendarDays},
  {id: "telegram", label: "تليجرام", Icon: Send},
] as const;

export default function AdminDashboard(){
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/admin/me", {cache: "no-store"})
      .then(async r => { if (r.status === 401) { router.push("/admin/login"); return; } setMe(await r.json()); })
      .catch(() => router.push("/admin/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!me?.authenticated) return;
    if (tab === "overview") {
      fetch("/api/admin/stats", {cache: "no-store"}).then(r => r.json()).then(setStats).catch(() => setStats({databaseConfigured: false}));
    } else if (tab !== "telegram") {
      setRows(null);
      fetch(`/api/admin/content?type=${tab}`, {cache: "no-store"}).then(r => r.json()).then(j => setRows(j.rows || [])).catch(() => setRows([]));
    }
  }, [me, tab]);

  const logout = async () => {
    await fetch("/api/admin/logout", {method: "POST"});
    router.push("/admin/login");
  };

  if (loading) return <PageHeading title="لوحة الإدارة" description="جارٍ التحقق من الجلسة…"/>;
  if (!me?.authenticated) return <PageHeading title="لوحة الإدارة" description="غير مسجّل الدخول"/>;

  return <>
    <PageHeading title="لوحة الإدارة" description={`${me.email} · ${me.role}`} action={<button className="action-button secondary" onClick={logout}><LogOut size={16}/> خروج</button>}/>
    <div className="tabs admin-tabs">
      {TABS.map(t => <button key={t.id} className={tab === t.id ? "selected" : ""} onClick={() => setTab(t.id)}><t.Icon size={15}/> {t.label}</button>)}
    </div>

    {notice && <p className="note" role="status">{notice}</p>}

    {tab === "overview" && <>
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
          <p className="subtle small">الإشعارات (tg_*): {stats?.counts?.filter(c => c.table.startsWith("tg_")).map(c => `${c.table.replace("tg_", "")}: ${c.count}`).join(" · ") || "—"}</p>
          <p className="subtle small">المستخدم الحالي: <Status tone="success">{me.role}</Status></p>
          <p className="subtle small">الواجهة القديمة (prototype): <a className="text-link" href="/admin-legacy">/admin-legacy</a></p>
        </div></div>
      </div>
    </>}

    {tab === "telegram" && <TelegramAdminInline/>}

    {tab !== "overview" && tab !== "telegram" && <div className="panel"><div className="panel-heading"><h2>{TABS.find(t => t.id === tab)?.label}</h2><span className="subtle small">{rows ? `${rows.length} سجل` : "…"}</span></div>
      <div className="panel-body">
        {rows === null ? <Empty description="جارٍ التحميل…"/> : rows.length ? <div className="stack">{rows.map((r, i) => <div className="list-row" key={String(r.id || i)}><div className="grow"><strong>{String(r.title || r.name || r.id)}</strong><p className="subtle small">{String(r.subject_id || r.subjectId || r.section || "")}</p></div></div>)}</div> : <Empty description="لا توجد بيانات بعد — استخدم /api/admin/content أو سكربت الترحيل."/>}
        <p className="subtle small" style={{marginTop:10}}>إنشاء وتعديل وحذف عبر <code>/api/admin/content</code> (محمي بجلسة أو x-admin-secret).</p>
      </div></div>}
  </>;
}

function TelegramAdminInline(){
  return <div className="panel"><div className="panel-heading"><h2><BellRing size={19}/> مركز إشعارات تليجرام</h2></div><div className="panel-body"><p className="subtle small">تفاصيل كاملة في <a className="text-link" href="/admin-legacy">لوحة الإدارة القديمة</a> — أو استخدم <code>/api/telegram/admin</code> بمفتاح <code>x-admin-secret</code>. الحالة: <code>/api/telegram/health</code>.</p></div></div>;
}
