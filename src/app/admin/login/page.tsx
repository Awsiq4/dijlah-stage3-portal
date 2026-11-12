"use client";
import {adminReturnPath} from "@/lib/safe-url";
import React,{Suspense,useEffect,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import Image from "next/image";
import {KeyRound,Lock} from "lucide-react";
import {browserSupportsWebAuthn,startAuthentication,type PublicKeyCredentialRequestOptionsJSON} from "@simplewebauthn/browser";
import {passkeyRequest} from "@/lib/passkey-client";
import {PageHeading} from "@/components/UI";

export default function AdminLogin(){
  return <Suspense fallback={null}><AdminLoginInner/></Suspense>;
}

function AdminLoginInner(){
  const router=useRouter();
  const params=useSearchParams();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [step,setStep]=useState<"password"|"factor"|"setup"|"rotate">("password");
  const [enrollmentToken,setEnrollmentToken]=useState("");
  const [existingCode,setExistingCode]=useState("");
  const [code,setCode]=useState("");
  const [setupKey,setSetupKey]=useState("");
  const [recoveryCodes,setRecoveryCodes]=useState<string[]>([]);
  const enrollment=step==="setup"||step==="rotate";
  const openDashboard=()=>{
    router.push(adminReturnPath(params.get("next")));
    router.refresh();
  };
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const [passkeysAvailable,setPasskeysAvailable]=useState(false);
  useEffect(()=>{setPasskeysAvailable(window.location.origin==="https://dj3.top"&&browserSupportsWebAuthn());},[]);

  async function signInWithPasskey(){
    setBusy(true);setError("");
    try{
      const {options}=await passkeyRequest<{options:PublicKeyCredentialRequestOptionsJSON}>("login-options");
      const response=await startAuthentication({optionsJSON:options});
      await passkeyRequest("login",{response});
      openDashboard();
    }catch(err){
      setError(err instanceof Error&&["NotAllowedError","AbortError"].includes(err.name)
        ? "أُلغي الدخول بالمفتاح أو ما توفر مفتاح على هذا الجهاز."
        : err instanceof Error ? err.message : "تعذّر تسجيل الدخول بالمفتاح.");
    }finally{setBusy(false);}
  }

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/admin/login",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password,code,enrollmentToken,existingCode}),
      });
      const j=await res.json().catch(()=>({}));
      if(res.status===202){
        if(j.step==="enrollment_required")setStep("setup");
        if(j.step==="factor_required")setStep("factor");
        if(j.step==="configure_authenticator"&&typeof j.setupKey==="string")setSetupKey(j.setupKey);
      }else if(res.ok&&j.ok){
        setPassword("");setCode("");setExistingCode("");setEnrollmentToken("");setSetupKey("");
        if(Array.isArray(j.recoveryCodes)&&j.recoveryCodes.length)setRecoveryCodes(j.recoveryCodes);
        else openDashboard();
      }else{
        setError(res.status===429 ? "محاولات دخول كثيرة. انتظر قليلًا ثم حاول مجددًا." :
          j.step==="invalid_factor" ? "رمز التحقق غير صالح أو انتهت صلاحيته. جرّب رمزًا جديدًا." :
          res.status===401 ? "تحقق من البريد الإلكتروني وكلمة المرور." : "تعذّر تسجيل الدخول. حاول مجددًا.");
      }
    }catch{ setError("تعذّر الاتصال بالخادم"); }
    finally{ setBusy(false); }
  };

  return <div className="ai-layout" style={{maxWidth:420,margin:"40px auto"}}>
    <div className="panel"><div className="panel-body" style={{padding:26}}>
      <div style={{textAlign:"center",marginBottom:14}}>
        <Image src="/images/department-logo.png" width={986} height={915} alt="" style={{width:56,height:"auto",margin:"0 auto"}}/>
      </div>
      <PageHeading title="تسجيل دخول الإدارة" description="للمالك والتدريسيين والممثلين"/>
      {passkeysAvailable&&step==="password"&&!recoveryCodes.length&&<button type="button" className="action-button secondary" style={{width:"100%",marginBottom:16}} onClick={signInWithPasskey} disabled={busy}><KeyRound size={16}/> الدخول بمفتاح</button>}
      {recoveryCodes.length>0 ? <>
        <p>احفظ رموز الاسترداد بمكان آمن. كل رمز يُستخدم مرة واحدة وتظهر الرموز هنا مرة واحدة.</p>
        <ul dir="ltr" aria-label="رموز الاسترداد">{recoveryCodes.map(value=><li key={value}><code>{value}</code></li>)}</ul>
        <button className="action-button" onClick={openDashboard}>حفظت الرموز، افتح لوحة الإدارة</button>
      </> : <>
        <form className="admin-form" style={{gridTemplateColumns:"1fr"}} onSubmit={submit}>
          <label className="form-field"><span>البريد الإلكتروني</span><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} readOnly={step!=="password"} required/></label>
          <label className="form-field"><span>كلمة المرور</span><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} readOnly={step!=="password"} required/></label>
          {enrollment&&<>
            <p className="subtle small">أرسل <code dir="ltr">/mfa_setup</code> للبوت من حساب Telegram المرتبط، ثم أدخل رمز الإعداد هنا.</p>
            <label className="form-field"><span>رمز الإعداد من البوت</span><input dir="ltr" autoComplete="off" maxLength={64} value={enrollmentToken} onChange={e=>{setEnrollmentToken(e.target.value);setSetupKey("");setCode("");}} required/></label>
            {step==="rotate"&&<label className="form-field"><span>رمز التحقق الحالي أو رمز الاسترداد</span><input dir="ltr" autoComplete="off" maxLength={64} value={existingCode} onChange={e=>setExistingCode(e.target.value)} required/></label>}
          </>}
          {setupKey&&<>
            <p>أضف حسابًا في تطبيق المصادقة، واختر مفتاحًا يستند إلى الوقت. أدخل المفتاح أدناه باسم «بوابة دجلة».</p>
            <label className="form-field"><span>مفتاح تطبيق المصادقة</span><input dir="ltr" value={setupKey} readOnly onFocus={e=>e.target.select()}/></label>
          </>}
          {(step==="factor"||setupKey)&&<label className="form-field">
            <span>{setupKey ? "الرمز من تطبيق المصادقة الجديد" : "رمز تطبيق المصادقة أو رمز الاسترداد"}</span>
            <input dir="ltr" inputMode={setupKey?"numeric":"text"} autoComplete="one-time-code" maxLength={setupKey?6:64} value={code} onChange={e=>setCode(e.target.value)} required/>
          </label>}
          {error&&<p className="subtle small" style={{color:"var(--st-danger-text)"}} role="alert">{error}</p>}
          <button className="action-button" style={{justifySelf:"stretch",width:"100%"}} disabled={busy}><Lock size={16}/> {busy?"جارٍ التحقق…":enrollment&&!setupKey?"عرض مفتاح الإعداد":"دخول"}</button>
          {step==="factor"&&<button type="button" className="action-button secondary" onClick={()=>{setStep("rotate");setCode("");setError("");}}>تغيير تطبيق المصادقة</button>}
          {step!=="password"&&<button type="button" className="action-button secondary" onClick={()=>{setStep("password");setPassword("");setCode("");setExistingCode("");setSetupKey("");setEnrollmentToken("");setError("");}}>العودة إلى تسجيل الدخول</button>}
        </form>
        <p style={{marginTop:12}}><a className="text-link" href="/admin/forgot-password">نسيت كلمة المرور؟ استعدها عبر Telegram</a></p>
      </>}
    </div></div>
  </div>;
}
