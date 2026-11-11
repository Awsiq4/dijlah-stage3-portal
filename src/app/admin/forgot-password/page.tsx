"use client";

import React, {useState} from "react";
import {Lock, ShieldCheck} from "lucide-react";
import {PageHeading} from "@/components/UI";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/request-password-reset", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({email}),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        setNotice("إذا كان حسابك مربوطًا بالبوت، يصلك رابط الاستعادة في محادثتك الخاصة. إذا ما فتحته من قبل، افتح البوت واضغط «بدء»، ثم أعد الطلب.");
      } else setError(result.error || "تعذر إرسال الرابط");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  };

  return <div style={{maxWidth: 440, margin: "42px auto"}}>
    <div className="panel"><div className="panel-body" style={{padding: 26}}>
      <PageHeading title="نسيت كلمة المرور؟" description="استعد دخولك باستخدام حساب Telegram المرتبط بالبوابة."/>
      <p className="subtle">أدخل بريد حسابك في البوابة. رابط الاستعادة صالح لمدة 30 دقيقة ويُستخدم مرة واحدة.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" style={{color: "var(--st-danger-text)"}}>{error}</p>}
      <form className="admin-form" style={{gridTemplateColumns: "1fr"}} onSubmit={submit}>
        <label className="form-field"><span>البريد الإلكتروني</span>
          <input dir="ltr" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/>
        </label>
        <button type="submit" className="action-button" style={{width: "100%"}} disabled={busy}>
          <Lock size={16}/>{busy ? "جارٍ الطلب..." : "إرسال رابط الاستعادة إلى Telegram"}
        </button>
      </form>
      <p className="subtle small" style={{display: "flex", gap: 7, marginTop: 15}}>
        <ShieldCheck size={15}/> لا نطلب منك كلمة المرور القديمة، ولا نعرض رابط الاستعادة لأي زائر.
      </p>
      <p><a className="text-link" href="/admin/login">العودة إلى تسجيل الدخول</a></p>
    </div></div>
  </div>;
}
