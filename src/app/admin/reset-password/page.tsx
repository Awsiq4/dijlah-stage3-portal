"use client";

import React, {Suspense, useEffect, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Lock, ShieldCheck} from "lucide-react";
import {PageHeading} from "@/components/UI";

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPasswordForm/></Suspense>;
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token] = useState(() => params.get("token") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Keep a one-time credential out of the address bar and browser history.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", "/admin/reset-password");
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setError("رابط الاستعادة غير صالح"); return; }
    if (password.length < 12 || password.length > 128) {
      setError("كلمة المرور يجب أن تكون بين 12 و128 حرفًا"); return;
    }
    if (password !== confirm) { setError("كلمتا المرور غير متطابقتين"); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: {"content-type": "application/json"},
        cache: "no-store",
        body: JSON.stringify({token, password}),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        setSuccess(true);
        setPassword("");
        setConfirm("");
      } else setError(result.error || "تعذرت الاستعادة");
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  };

  return <div style={{maxWidth: 440, margin: "42px auto"}}>
    <div className="panel"><div className="panel-body" style={{padding: 26}}>
      <PageHeading title="استعادة كلمة مرور الإدارة" description="اختر كلمة مرور جديدة لحسابك الإداري."/>
      {success ? <>
        <p role="status" style={{marginTop: 12}}>✅ تم تحديث كلمة المرور وإلغاء جلسات الدخول السابقة بنجاح.</p>
        <button className="action-button" style={{width: "100%"}} onClick={() => router.push("/admin/login")}>
          الانتقال لتسجيل الدخول
        </button>
      </> : <>
        {!token && <p role="alert">⚠️ رابط الاستعادة مفقود أو غير صالح. استخدم الرابط الأصلي في رسالة Telegram.</p>}
        <form className="admin-form" style={{gridTemplateColumns: "1fr"}} onSubmit={submit}>
          <label className="form-field"><span>كلمة المرور الجديدة</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)}/></label>
          <label className="form-field"><span>تأكيد كلمة المرور</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)}/></label>
          {error && <p role="alert" style={{color: "var(--st-danger-text)"}}>{error}</p>}
          <button className="action-button" style={{width: "100%"}} type="submit" disabled={busy || !token}>
            <Lock size={16}/>{busy ? "جارٍ الحفظ..." : "تعيين كلمة المرور الجديدة"}
          </button>
        </form>
      </>}
      <p className="subtle small" style={{display: "flex", alignItems: "center", gap: 6, marginTop: 14}}>
        <ShieldCheck size={15}/> رابط لمرة واحدة، وكلمة المرور لا تظهر في الرسائل ولا تُخزّن بشكل مقروء.
      </p>
    </div></div>
  </div>;
}
