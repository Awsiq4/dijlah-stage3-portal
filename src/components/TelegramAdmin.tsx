"use client";
import React,{useState} from "react";
import {BellRing,FlaskConical,RefreshCw} from "lucide-react";
import {Empty,Status} from "@/components/UI";

type Stats = {
  subs: {total: number; active: number; stopped: number};
  bySection: {section: string; total: number; active: number}[];
  events: {events: number};
  deliveries: {status: string; n: number}[];
  recentEvents: {id: number; event_key: string; type: string; title: string; scope: string; section: string | null; priority: string; created_at: string}[];
};
type AdminResp = {
  enabled: boolean; flag: boolean; botConfigured: boolean; databaseConfigured: boolean;
  bot: {username?: string; isBot?: boolean} | {code?: number; description?: string} | null;
  stats: Stats | null;
};

export default function TelegramAdmin(){
  const [data, setData] = useState<AdminResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/telegram/admin", {cache: "no-store"});
      if (res.status === 403) { setMsg("هذه العملية تتطلب جلسة المالك."); setData(null); }
      else setData(await res.json());
    } catch { setMsg("تعذّر الاتصال."); }
    finally { setBusy(false); }
  };

  const testNotify = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/telegram/admin", {
        method: "POST",
        headers: {"content-type": "application/json", "x-portal-admin": "1"},
        body: JSON.stringify({action: "test"}),
      });
      const j = await res.json();
      setMsg(res.ok && j.ok ? "تم إرسال إشعار الاختبار إلى حساب المالك." : j.error || "تعذّر إرسال إشعار الاختبار.");
    } catch { setMsg("تعذّر الاتصال."); }
    finally { setBusy(false); }
  };

  return <div className="panel"><div className="panel-heading"><h2><BellRing size={20}/> مركز إشعارات تليجرام</h2></div>
    <div className="panel-body">
      <p className="subtle small">إدارة خدمة إشعارات البوت (Webhook + قاعدة بيانات + طابور التسليم). مفاتيح API تُقرأ من متغيرات بيئة Vercel فقط — لا تُخزن هنا.</p>
      <div className="admin-actions">
        <button className="action-button secondary" onClick={load} disabled={busy}><RefreshCw size={16}/> تحميل الحالة</button>
        <button className="action-button" onClick={testNotify} disabled={busy}><FlaskConical size={16}/> إرسال اختبار للمالك</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {!data && <Empty description="اضغط «تحميل الحالة»."/>}
      {data && <>
        <div className="stats">
          <div className="stat"><BellRing size={21}/><span>المشتركين النشطين</span><strong>{data.stats?.subs.active ?? "—"}</strong></div>
          <div className="stat"><BellRing size={21}/><span>إجمالي المشتركين</span><strong>{data.stats?.subs.total ?? "—"}</strong></div>
          <div className="stat"><BellRing size={21}/><span>الإشعارات المرسلة</span><strong>{data.stats?.deliveries.find(d => d.status === "sent")?.n ?? 0}</strong></div>
          <div className="stat"><BellRing size={21}/><span>قيد الانتظار/فاشلة</span><strong>{(data.stats?.deliveries.find(d => d.status === "pending")?.n || 0) + (data.stats?.deliveries.find(d => d.status === "failed")?.n || 0)}</strong></div>
        </div>
        <p className="subtle small">حالة الخدمة: {data.enabled ? <Status tone="success">مفعّلة</Status> : <Status tone="warning">معطّلة</Status>} · البوت: {data.botConfigured ? <Status tone="success">{data.bot && "username" in data.bot ? data.bot.username : "متصل"}</Status> : <Status tone="danger">غير مهيأ</Status>} · قاعدة البيانات: {data.databaseConfigured ? <Status tone="success">متصلة</Status> : <Status tone="danger">غير مهيأة</Status>} · الـflag: {data ? (data.flag ? "مفعّل" : "متوقف") : ""}</p>
        {data.stats && <>
          <h3>المشتركين حسب الشعبة</h3>
          <div className="stack">{data.stats.bySection.map(b => <div className="kv" key={b.section}><span>شعبة {b.section}</span><strong>{b.active} / {b.total}</strong></div>)}</div>
          <h3>آخر الأحداث</h3>
          {data.stats.recentEvents.length ? <div className="stack">{data.stats.recentEvents.slice(0, 8).map(e => <div className="kv" key={e.id}><span>{e.event_key}</span><strong>{e.type} · {e.scope}{e.section ? ` · ${e.section}` : ""}</strong></div>)}</div> : <Empty/>}
        </>}
        <p className="subtle small">الإعداد الكامل: docs/TELEGRAM_BOT_SETUP.md</p>
      </>}
    </div>
  </div>;
}
