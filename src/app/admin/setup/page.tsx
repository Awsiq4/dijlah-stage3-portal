"use client";
import React,{Suspense,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {Lock,ShieldCheck} from "lucide-react";
import {PageHeading} from "@/components/UI";

export default function AdminSetup(){
  return <Suspense fallback={null}><AdminSetupInner/></Suspense>;
}

function AdminSetupInner(){
  const router=useRouter();
  const params=useSearchParams();
  const token=params.get("token")||"";
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    setError("");
    if(password.length<12){setError("كلمة المرور 12 حرفًا على الأقل");return;}
    if(password!==confirm){setError("كلمتا المرور غير متطابقتين");return;}
    setBusy(true);
    try{
      const res=await fetch("/api/admin/setup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,password})});
      const j=await res.json().catch(()=>({}));
      if(res.ok&&j.ok){router.push("/admin");router.refresh();}
      else setError(j.error||"تعذر إكمال الإعداد");
    }catch{setError("تعذر الاتصال بالخادم");}
    finally{setBusy(false);}
  };

  return <div style={{maxWidth:420,margin:"40px auto"}}>
    <div className="panel"><div className="panel-body" style={{padding:26}}>
      <PageHeading title="تفعيل الحساب" description="عيّن كلمة المرور الخاصة بحسابك الإداري — رابط الدعوة يُستخدم مرة واحدة فقط."/>
      {!token&&<p className="subtle small" role="alert">رابط الدعوة غير صالح — اطلب رابطًا جديدًا من السوبر admin.</p>}
      <form className="admin-form" style={{gridTemplateColumns:"1fr"}} onSubmit={submit}>
        <label className="form-field"><span>كلمة المرور الجديدة</span><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        <label className="form-field"><span>تأكيد كلمة المرور</span><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label>
        {error&&<p className="subtle small" style={{color:"var(--st-danger-text)"}} role="alert">{error}</p>}
        <button className="action-button" style={{justifySelf:"stretch",width:"100%"}} disabled={busy||!token}><Lock size={16}/> {busy?"جارٍ التفعيل…":"تفعيل الحساب"}</button>
      </form>
      <p><a className="text-link" href="/admin/login">عندي حساب، سجّل دخول</a></p>
      <p className="subtle small" style={{marginTop:12,display:"flex",gap:6,alignItems:"center"}}><ShieldCheck size={15}/> كلمة المرور تُجزأ بـscrypt ولا تظهر في أي مكان.</p>
    </div></div>
  </div>;
}
