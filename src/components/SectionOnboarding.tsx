"use client";
import React,{useEffect,useState} from "react";
import Image from "next/image";
import {SECTIONS} from "@/lib/seed";
import {usePortal} from "@/lib/storage";
import type {Section} from "@/lib/types";

const ONBOARD_KEY="dijlah-stage3-onboarded";
const SECTION_KEY="dijlah-stage3-section";

export default function SectionOnboarding(){
  const {section,setSection,hydrated}=usePortal();
  const [visible,setVisible]=useState(false);
  const [choice,setChoice]=useState<Section|null>(null);

  useEffect(()=>{
    if(!hydrated)return;
    try{
      if(localStorage.getItem(ONBOARD_KEY)||localStorage.getItem(SECTION_KEY))return;
      setVisible(true);
    }catch{/* localStorage unavailable: skip onboarding, site stays usable */}
  },[hydrated]);

  const confirm=()=>{
    if(!choice)return;
    setSection(choice);
    try{
      localStorage.setItem(SECTION_KEY,choice);
      localStorage.setItem(ONBOARD_KEY,"1");
    }catch{/* storage unavailable: selection still applies for this session */}
    setVisible(false);
  };

  if(!visible)return null;
  return <div className="onboard-overlay" role="dialog" aria-modal="true" aria-label="اختيار الشعبة الدراسية">
    <div className="onboard-card">
      <Image className="onboard-logo" src="/images/department-logo.png" width={986} height={915} alt="شعار قسم هندسة الليزر والإلكترونيات البصرية" priority/>
      <h1>مرحباً بك في بوابة طلبة المرحلة الثالثة</h1>
      <p>اختر شعبتك الدراسية حتى نعرض لك الجدول والتبليغات والمعلومات الخاصة بشعبتك.</p>
      <div className="onboard-grid">
        {SECTIONS.map(s=><button key={s} type="button" className={`onboard-opt ${choice===s?"selected":""}`} onClick={()=>setChoice(s)} aria-pressed={choice===s}>شعبة {s}<small>المرحلة الثالثة</small></button>)}
      </div>
      <button type="button" className="action-button onboard-cta" onClick={confirm} disabled={!choice}>متابعة إلى البوابة</button>
    </div>
  </div>;
}
