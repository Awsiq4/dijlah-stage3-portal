"use client";
import React,{Suspense,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import Image from "next/image";
import {Lock,ShieldCheck} from "lucide-react";
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
        router.push(params.get("next")||"/admin");
        router.refresh();
      }else{
        setError(j.error||"فشل تسجيل الدخول");
      }
    }catch{ setError("تعذّر الاتصال بالخادم"); }
    finally{ setBusy(false); }
  };

  return <div className="ai-layout" style={{maxWidth:420,margin:"40px auto"}}>
    <div className="panel"><div className="panel-body" style={{padding:26}}>
      <div style={{textAlign:"center",marginBottom:14}}>
        <Image src="/images/department-logo.png" width={986} height={915} alt="" style={{width:56,height:"auto",margin:"0 auto"}}/>
      </div>
      <PageHeading title="تسجيل دخول الإدارة" description="Super Admin فقط — الوصول محمي من الخادم"/>
      <form className="admin-form" style={{gridTemplateColumns:"1fr"}} onSubmit={submit}>
        <label className="form-field"><span>البريد الإلكتروني</span><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label className="form-field"><span>كلمة المرور</span><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        {error&&<p className="subtle small" style={{color:"var(--st-danger-text)"}} role="alert">{error}</p>}
        <button className="action-button" style={{justifySelf:"stretch",width:"100%"}} disabled={busy}><Lock size={16}/> {busy?"جارٍ التحقق…":"دخول"}</button>
      </form>
      <p className="subtle small" style={{marginTop:12,display:"flex",gap:6,alignItems:"center"}}><ShieldCheck size={15}/> الجلسة مخزنة في cookie httpOnly؛ تُتحقق من الخادم في كل طلب. القديم متاح في <a className="text-link" href="/admin-legacy">/admin-legacy</a>.</p>
    </div></div>
  </div>;
}
