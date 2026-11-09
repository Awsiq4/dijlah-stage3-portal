"use client";

import {useState} from "react";
import {MessageCircle,Lightbulb,Bug,ArrowUpLeft} from "lucide-react";
import "./support.css";

const items = [
  {id:"support",label:"تواصل مع الدعم",Icon:MessageCircle},
  {id:"idea",label:"اقترح فكرة",Icon:Lightbulb},
  {id:"problem",label:"بلّغ عن مشكلة",Icon:Bug},
] as const;
type Category=typeof items[number]["id"];

export default function SupportPage() {
  const [busy,setBusy]=useState<Category|null>(null);
  const [error,setError]=useState("");
  const [fallback,setFallback]=useState("");

  async function openSupport(category:Category) {
    if(busy)return;
    setBusy(category);setError("");setFallback("");
    try {
      const response=await fetch("/api/support/entry",{
        method:"POST",
        headers:{"content-type":"application/json","x-support-entry":"1"},
        body:JSON.stringify({category}),
        cache:"no-store",
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||typeof result.url!=="string"||!result.url.startsWith("https://t.me/"))
        throw new Error(result.error||"ما گدرنا نفتح البوت. جرّب مرة ثانية.");
      setFallback(result.url);
      window.location.assign(result.url);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"تعذّر فتح الدعم.");
    } finally {
      setBusy(null);
    }
  }

  return <section className="site-support" dir="rtl">
    <header className="site-support-heading">
      <h1>الدعم والاقتراحات</h1>
      <p>شلون نكدر نساعدك؟</p>
    </header>
    <div className="site-support-actions">
      {items.map(({id,label,Icon})=><button key={id} type="button"
        className="site-support-action" disabled={busy!==null}
        onClick={()=>void openSupport(id)}>
        <span className="site-support-action-icon"><Icon size={22}/></span>
        <strong>{label}</strong>
        <ArrowUpLeft aria-hidden="true" size={18} className="site-support-arrow"/>
      </button>)}
    </div>
    {error&&<p className="site-support-error" role="alert">{error}</p>}
    {fallback&&<a className="site-support-fallback" href={fallback}>اضغط هنا إذا ما انفتح البوت</a>}
  </section>;
}
