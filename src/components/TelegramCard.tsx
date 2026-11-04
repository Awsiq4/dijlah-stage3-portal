"use client";
import React,{useEffect,useState} from "react";
import {BellRing,Send} from "lucide-react";
import {usePortal} from "@/lib/storage";
import {Status} from "@/components/UI";

type Health = {enabled: boolean; botConfigured: boolean; databaseConfigured: boolean; flag: boolean; botUsername: string | null};

export default function TelegramCard(){
  const {section} = usePortal();
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/telegram/health", {cache: "no-store"})
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({enabled: false, botConfigured: false, databaseConfigured: false, flag: false, botUsername: null}));
  }, []);

  const activate = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/telegram/subscribe", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({section}),
      });
      const data = await res.json();
      if (!res.ok || !data.enabled) { setError("الخدمة غير مفعّلة بعد — حاول مجددًا لاحقًا."); setBusy(false); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = !health?.enabled;
  return <section className="panel tg-card">
    <div className="panel-body tg-card-body">
      <div className="round-icon"><BellRing size={22}/></div>
      <div className="grow">
        <strong>خليك على اطلاع بكل جديد</strong>
        <p className="subtle small">فعّل إشعارات التليجرام حتى توصلك المحاضرات والتبليغات والامتحانات وتغييرات الجدول أولًا بأول — لشعبتك ({section}).</p>
        <div className="subtle small tg-cats">📚 محاضرات · 📢 الامتحانات · 📣 تبليغات · 🗓️ جدول · 📝 واجبات</div>
      </div>
      <div className="tg-card-action">
        <button type="button" className="action-button" onClick={activate} disabled={busy || disabled}>
          <Send size={16}/> {busy ? "جارٍ…" : "تفعيل الإشعارات"}
        </button>
        {health && !health.enabled && <Status tone="warning">غير مفعّلة بعد</Status>}
        {error && <p className="subtle small">{error}</p>}
      </div>
    </div>
  </section>;
}
