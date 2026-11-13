"use client";
import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {SECTIONS} from "./seed";
import {mapAuthoritativeContent} from "./public-map";
import {needsPublicContent} from "./public-route";
import {hasVerifiedSection,shouldRevalidate} from "./public-readiness";
import type {PortalData,Section} from "./types";

export type ContentStatus = "loading" | "ready" | "error";
type State = {
  data:PortalData;
  setData:(updater:(current:PortalData)=>PortalData)=>void;
  section:Section;
  setSection:(value:Section)=>void;
  dark:boolean;
  toggleDark:()=>void;
  reset:()=>void;
  hydrated:boolean;
  contentStatus:ContentStatus;
  contentSection:Section|null;
  reloadContent:()=>void;
};
const Context=createContext<State|null>(null);
const SECTION_KEY="dijlah-stage3-section";
const THEME_KEY="dijlah-stage3-theme";

// Never render baked-in prototype or localStorage content as published content.
// Preserve only personal preferences (section and theme) between visits.
const emptyData:PortalData={
  subjects:[],lectures:[],summaries:[],schedule:[],exams:[],questions:[],announcements:[],assignments:[],
  telegram:{general:"",sections:{A:"",B:"",C:"",F:""},subjects:{}},
};

export function PortalProvider({children}:{children:React.ReactNode}){
  const pathname=usePathname();
  const needsData=needsPublicContent(pathname);
  const [data,updateData]=useState<PortalData>(emptyData);
  const [section,updateSection]=useState<Section>("A");
  const [dark,setDark]=useState(false);
  const [hydrated,setHydrated]=useState(false);
  const [contentStatus,setContentStatus]=useState<ContentStatus>("loading");
  const [contentSection,setContentSection]=useState<Section|null>(null);
  const [reloadTick,setReloadTick]=useState(0);
  const lastRequestedAt=useRef(0);
  const fetchSerial=useRef(0);
  const themeCleanup=useRef<(()=>void)|null>(null);
  // A single verified snapshot is reused across routes in the same section;
  // no localStorage or seed data is used as public content.


  useEffect(()=>{
    try{
      const linkedPublication=pathname==="/announcements"||pathname?.startsWith("/lectures/")||pathname?.startsWith("/subjects/");
      const linkSection=linkedPublication?new URLSearchParams(window.location.search).get("section"):null;
      const savedSection=localStorage.getItem(SECTION_KEY);
      const selected=SECTIONS.includes(linkSection as Section)?linkSection:savedSection;
      if(SECTIONS.includes(selected as Section))updateSection(selected as Section);
      const preference=localStorage.getItem(THEME_KEY);
      const mq=window.matchMedia("(prefers-color-scheme: dark)");
      const apply=(enabled:boolean)=>{
        setDark(enabled);
        document.documentElement.dataset.theme=enabled?"dark":"light";
      };
      apply(preference?preference==="dark":mq.matches);
      const onSystem=(e:MediaQueryListEvent)=>{
        if(!localStorage.getItem(THEME_KEY))apply(e.matches);
      };
      mq.addEventListener("change",onSystem);
      themeCleanup.current=()=>mq.removeEventListener("change",onSystem);
    }catch(err){console.warn("Unable to read local display preferences",err);}
    setHydrated(true);
  // Only read the deep-link query once, not every time a route changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>()=>themeCleanup.current?.(),[]);

  useEffect(()=>{
    if(!hydrated||!needsData)return;
    const controller=new AbortController();
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},12000);
    lastRequestedAt.current=Date.now();
    const requestId=++fetchSerial.current;
    // New section or first visit: wait for a verified snapshot.
    // Same-section background refresh: keep content visible and navigable.
    const verified=hasVerifiedSection(hydrated,contentStatus,contentSection,section);
    if(!verified)setContentStatus("loading");
    const load=async()=>{
      try{
        const response=await fetch(`/api/public/content?type=all&section=${section}`,
          {cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("public-content-http-"+response.status);
        const payload=await response.json();
        if(!payload||payload.fromDatabase!==true||!payload.content||payload.section!==section)
          throw new Error("public-content-not-authoritative");
        if(controller.signal.aborted||requestId!==fetchSerial.current)return;
        updateData(mapAuthoritativeContent(payload.content));
        setContentSection(section);
        setContentStatus("ready");
      }catch(err){
        if((controller.signal.aborted&&!timedOut)||requestId!==fetchSerial.current)return;
        console.warn("Public content could not be loaded",
          err instanceof Error?err.message:"unknown");
        // Do not hide verified content because a background refresh failed.
        // On first fetch or section change, show a retryable error instead.
        if(!verified)setContentStatus("error");
      }
    };
    void load().finally(()=>clearTimeout(timeout));
    return ()=>{clearTimeout(timeout);controller.abort();};
  // Important: no pathname dependency. Changing routes within a section
  // must NOT refetch data or display the loading skeleton.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hydrated,section,reloadTick,needsData]);
  // If a student comes back after two minutes, or navigates after idle,
  // revalidate in the background. Requests are throttled per session.
  useEffect(()=>{
    if(!hydrated||!needsData)return;
    if(shouldRevalidate(lastRequestedAt.current,Date.now()))
      setReloadTick(n=>n+1);
  },[hydrated,needsData,pathname]);
  useEffect(()=>{
    if(!hydrated)return;
    const onReturn=()=>{
      if(document.visibilityState==="visible" &&
        needsPublicContent(window.location.pathname) &&
        shouldRevalidate(lastRequestedAt.current,Date.now())) {
        setReloadTick(n=>n+1);
      }
    };
    document.addEventListener("visibilitychange",onReturn);
    window.addEventListener("focus",onReturn);
    return ()=>{
      document.removeEventListener("visibilitychange",onReturn);
      window.removeEventListener("focus",onReturn);
    };
  },[hydrated]);
  useEffect(()=>{
    if(hydrated)try{localStorage.setItem(SECTION_KEY,section);}catch{/* unavailable storage */}
  },[section,hydrated]);
  useEffect(()=>{
    document.documentElement.dataset.theme=dark?"dark":"light";
  },[dark]);
  const setData=useCallback((updater:(current:PortalData)=>PortalData)=>updateData(prev=>updater(prev)),[]);
  const reloadContent=useCallback(()=>setReloadTick(v=>v+1),[]);
  const reset=reloadContent;
  const toggleDark=useCallback(()=>setDark(v=>{
    const next=!v;
    try{localStorage.setItem(THEME_KEY,next?"dark":"light");}catch{/* unavailable storage */}
    return next;
  }),[]);
  const value=useMemo(()=>({
    data,setData,section,setSection:updateSection,dark,toggleDark,reset,hydrated,
    contentStatus,contentSection,reloadContent,
  }),[data,setData,section,dark,toggleDark,reset,hydrated,
      contentStatus,contentSection,reloadContent]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePortal(){
  const ctx=useContext(Context);
  if(!ctx)throw new Error("PortalProvider missing");
  return ctx;
}
