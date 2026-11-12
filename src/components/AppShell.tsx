"use client";
import Link from "next/link";
import Image from "next/image";
import {usePathname} from "next/navigation";
import {BookOpen,CalendarDays,House,Menu,MessageSquareText,Moon,Sun,Shield} from "lucide-react";
import {SECTIONS} from "@/lib/seed";
import {usePortal} from "@/lib/storage";
import SectionOnboarding from "@/components/SectionOnboarding";
import type {Section} from "@/lib/types";
import React, {createContext, useContext, useEffect, useState} from "react";

const AdminNavigationContext = createContext(false);
const ADMIN_ROLES = new Set(["super_admin", "editor", "general_representative", "section_representative", "teacher"]);

export function useAdminNavigation() {
  return useContext(AdminNavigationContext);
}
const nav=[{href:"/",label:"الرئيسية",Icon:House},{href:"/subjects",label:"المواد",Icon:BookOpen},{href:"/schedule",label:"الجدول",Icon:CalendarDays},{href:"/announcements",label:"التبليغات",Icon:MessageSquareText},{href:"/more",label:"المزيد",Icon:Menu}];
export default function AppShell({children}:{children:React.ReactNode}){
 const path=usePathname();const {section,setSection,dark,toggleDark}=usePortal();
 const adminWorkspace = path === "/admin" || path === "/admin/passkeys";
 const [authorizedPath, setAuthorizedPath] = useState<string | null>(null);
 const showAdmin = authorizedPath !== null && authorizedPath === path;
 useEffect(() => {
   if (adminWorkspace) return;
   const controller = new AbortController();
   setAuthorizedPath(null);
   fetch("/api/admin/me", {cache: "no-store", signal: controller.signal})
     .then(async response => {
       const account = response.ok ? await response.json() : null;
       if (!controller.signal.aborted) {
         setAuthorizedPath(account?.authenticated === true && account.status === "active" && ADMIN_ROLES.has(account.role) ? path : null);
       }
     })
     .catch(() => { if (!controller.signal.aborted) setAuthorizedPath(null); });
   return () => controller.abort();
 }, [path, adminWorkspace]);
 return <AdminNavigationContext.Provider value={showAdmin}><div className={adminWorkspace ? "app app-admin-workspace" : "app"}><header className="header"><div className="header-inner"><Link href="/" className="brand"><Image className="brand-uni" src="/images/university-mark.png" width={1024} height={1024} alt="شعار جامعة دجلة" priority/><span><strong>بوابة طلبة المرحلة الثالثة</strong><small>هندسة الليزر والإلكترونيات البصرية · 2026–2027</small></span><Image className="brand-dept" src="/images/department-logo.png" width={986} height={915} alt="شعار قسم هندسة الليزر والإلكترونيات البصرية" priority/></Link><div className="header-actions">{!adminWorkspace && <label className="section-control"><span>الشعبة</span><select aria-label="اختر الشعبة" value={section} onChange={e=>setSection(e.target.value as Section)}>{SECTIONS.map(s=><option key={s} value={s}>{s}</option>)}</select></label>}<button type="button" className="icon-button" onClick={toggleDark} aria-pressed={dark} aria-label={dark?"تفعيل الوضع الفاتح":"تفعيل الوضع المظلم"} title="تبديل الوضع">{dark?<Sun size={19}/>:<Moon size={19}/>}</button></div></div></header><div className="page-shell">{!adminWorkspace && <aside className="sidebar"><div className="nav-caption">القائمة الرئيسية</div>{nav.map(({href,label,Icon})=><Link key={href} href={href} className={`side-link ${path===href?"active":""}`}><Icon size={19}/><span>{label}</span></Link>)}{showAdmin && <><hr/><a className="side-link" href="/admin"><Shield size={19}/>لوحة الإدارة</a></>}</aside>}<main className="content">{children}<footer className="footer"><span className="footer-brand"><Image className="uni-logo" src="/images/university-lockup.png" width={1180} height={163} alt="جامعة دجلة — Dijlah University"/><span className="subtle">بوابة طلابية مستقلة — ليست الموقع الرسمي للجامعة</span></span><strong>برمجة وتطوير: Aws Faris</strong></footer></main></div>{!adminWorkspace && <><nav className="bottom-nav" aria-label="القائمة الرئيسية">{nav.map(({href,label,Icon})=><Link key={href} className={`bottom-link ${path===href?"active":""}`} href={href}><Icon size={21}/><span>{label}</span></Link>)}</nav><SectionOnboarding/></>}</div></AdminNavigationContext.Provider>
}
