"use client";

import {useEffect, useState, type FormEvent} from "react";
import {browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON} from "@simplewebauthn/browser";
import {KeyRound, Plus, Trash2} from "lucide-react";
import {PageHeading} from "@/components/UI";
import {passkeyRequest} from "@/lib/passkey-client";

type Key = {id: string; label: string; created_at: string; last_used_at: string | null};

const date = new Intl.DateTimeFormat("ar-IQ", {dateStyle: "medium", timeZone: "Asia/Baghdad"});

export default function PasskeysPanel({owner}: {owner: boolean}) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/passkeys", {cache: "no-store"});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "تعذّر تحميل المفاتيح.");
    setKeys(data.keys);
  }

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load().catch(err => setError(err instanceof Error ? err.message : "تعذّر تحميل المفاتيح."));
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const {options} = await passkeyRequest<{options: PublicKeyCredentialCreationOptionsJSON}>("register-options", {password, code});
      setPassword("");
      setCode("");
      const response = await startRegistration({optionsJSON: options});
      await passkeyRequest("register", {response, label});
      setLabel("");
      setNotice("تمت إضافة مفتاح الدخول.");
      await load();
    } catch (err) {
      setError(err instanceof Error && ["NotAllowedError", "AbortError"].includes(err.name)
        ? "أُلغي الإعداد أو انتهت مهلته. يمكنك المحاولة مجدداً."
        : err instanceof Error ? err.message : "تعذّر إضافة المفتاح.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(key: Key) {
    if (!confirm(`إزالة مفتاح «${key.label}» وإنهاء الجلسات المفتوحة باستخدامه؟`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await passkeyRequest<{signedOut: boolean}>("remove", {id: key.id});
      if (result.signedOut) {
        window.location.assign("/admin/login");
        return;
      }
      setNotice("تمت إزالة المفتاح.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّرت إزالة المفتاح.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeading title="مفاتيح الدخول" description="ادخل إلى حسابك ببصمة الوجه أو بصمة الإصبع أو رمز قفل الجهاز."
      action={<a href="/admin" className="action-button secondary">العودة إلى لوحة الإدارة</a>}/>
    <div className="stack">
      {error && <p className="note" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}
      <section className="panel">
        <div className="panel-heading"><h2>مفاتيح حسابك</h2></div>
        <div className="panel-body">
          {keys === null ? <p>جارٍ تحميل المفاتيح…</p> : keys.length === 0 ? <p className="subtle">ما عندك مفتاح دخول مسجّل بعد.</p> : <ul className="stack">
            {keys.map(key => <li className="kv" key={key.id}>
              <div><strong>{key.label}</strong><p className="subtle small">
                أُضيف {date.format(new Date(key.created_at))} · {key.last_used_at ? `آخر استخدام ${date.format(new Date(key.last_used_at))}` : "بانتظار أول استخدام"}
              </p></div>
              <button type="button" className="action-button secondary" onClick={() => void remove(key)} disabled={busy}>
                <Trash2 size={16}/> إزالة<span className="sr-only"> {key.label}</span>
              </button>
            </li>)}
          </ul>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2><KeyRound size={20}/> إضافة مفتاح دخول</h2></div>
        <div className="panel-body">
          {!supported ? <p className="subtle">افتح dj3.top في متصفح يدعم مفاتيح الدخول، مثل Safari على الآيفون.</p> :
            <form className="admin-form" onSubmit={add}>
              <label className="form-field"><span>اسم الجهاز أو المفتاح</span><input value={label} onChange={e => setLabel(e.target.value)} placeholder="مثلاً آيفوني" maxLength={60} required disabled={busy}/></label>
              <label className="form-field"><span>كلمة المرور</span><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy}/></label>
              {owner && <label className="form-field"><span>رمز تطبيق المصادقة</span><input dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required disabled={busy}/><small className="subtle">استخدم رمزاً جديداً إذا استعملت الرمز الحالي لتسجيل الدخول.</small></label>}
              <div className="admin-actions"><button className="action-button" disabled={busy || keys === null || keys.length >= 10}>
                <Plus size={16}/> {busy ? "جارٍ التحقق…" : "إضافة مفتاح"}
              </button></div>
            </form>}
        </div>
      </section>
    </div>
  </>;
}
