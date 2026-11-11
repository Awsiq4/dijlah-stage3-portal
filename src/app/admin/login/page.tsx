"use client";
import {adminReturnPath} from "@/lib/safe-url";
import React,{Suspense,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import Image from "next/image";
import {Lock} from "lucide-react";
import {PageHeading} from "@/components/UI";

export default function AdminLogin(){
  return <Suspense fallback={null}><AdminLoginInner/></Suspense>;
}

function AdminLoginInner(){
  const router=useRouter();
  const params=useSearchParams();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
      const j=await res.json().catch(()=>({}));
      if(res.ok&&j.ok){
        router.push(adminReturnPath(params.get("next")));
        router.refresh();
      }else{
        setError(res.status===429 ? "محاولات دخول كثيرة. انتظر قليلًا ثم حاول مجددًا." : res.status===401 ? "تحقق من البريد الإلكتروني وكلمة المرور." : "تعذّر تسجيل الدخول. حاول مجددًا.");
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
      <form className="admin-form" style={{gridTemplateColumns:"1fr"}} onSubmit={submit}>
        <label className="form-field"><span>البريد الإلكتروني</span><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label className="form-field"><span>كلمة المرور</span><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        {error&&<p className="subtle small" style={{color:"var(--st-danger-text)"}} role="alert">{error}</p>}
        <button className="action-button" style={{justifySelf:"stretch",width:"100%"}} disabled={busy}><Lock size={16}/> {busy?"جارٍ التحقق…":"دخول"}</button>
      </form>
      <p style={{marginTop:12}}><a className="text-link" href="/admin/forgot-password">نسيت كلمة المرور؟ استعدها عبر Telegram</a></p>
    </div></div>
  </div>;
}
