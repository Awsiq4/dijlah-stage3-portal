"use client";
import React, {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from "react";
import {SEED,SECTIONS} from "./seed";
import {mergeById} from "./merge";
import {mapPublicContent} from "./public-map";
import type {PortalData,Section} from "./types";

type State = { data:PortalData; setData:(updater:(current:PortalData)=>PortalData)=>void; section:Section; setSection:(value:Section)=>void; dark:boolean; toggleDark:()=>void; reset:()=>void; hydrated:boolean };
const Context=createContext<State|null>(null);
const STORE_KEY="dijlah-stage3-prototype-data-v3";
const SECTION_KEY="dijlah-stage3-section";
const SCHED_HASH_KEY="dijlah-stage3-schedule-hash";
const hashStr=(v:string)=>{let h=5381;for(let i=0;i<v.length;i++)h=(h*33^v.charCodeAt(i))>>>0;return h.toString(36);};
const THEME_KEY="dijlah-stage3-theme";

export function PortalProvider({children}:{children:React.ReactNode}){
  const [data,updateData]=useState<PortalData>(SEED);
  const [section,updateSection]=useState<Section>("A");
  const [dark,setDark]=useState(false);
  const [hydrated,setHydrated]=useState(false);
  const themeCleanup=useRef<(()=>void)|null>(null);
  // When the public read-only API reports fromDatabase:true, server-published content
  // becomes authoritative and is NOT written back into the localStorage prototype store.
  const fromServer=useRef(false);
  useEffect(()=>{
    try {
      const stored=localStorage.getItem(STORE_KEY);
      if(stored){const parsed=JSON.parse(stored) as Partial<PortalData>; updateData({...SEED,...parsed,lectures:mergeById(SEED.lectures,parsed.lectures),schedule:(parsed.schedule&&localStorage.getItem(SCHED_HASH_KEY)===hashStr(JSON.stringify(SEED.schedule)))?mergeById(SEED.schedule,parsed.schedule):SEED.schedule,exams:mergeById(SEED.exams,parsed.exams),announcements:mergeById(SEED.announcements,parsed.announcements),assignments:mergeById(SEED.assignments,parsed.assignments),telegram:{...SEED.telegram,...parsed.telegram,sections:{...SEED.telegram.sections,...parsed.telegram?.sections}}});}
      const linkedPublication = window.location.pathname === "/announcements" || window.location.pathname.startsWith("/lectures/");
      const linkSection = linkedPublication ? new URLSearchParams(window.location.search).get("section") : null;
      const sel = SECTIONS.includes(linkSection as Section) ? linkSection : localStorage.getItem(SECTION_KEY);
      if(SECTIONS.includes(sel as Section))updateSection(sel as Section);
      const pref=localStorage.getItem(THEME_KEY);
      const mq=window.matchMedia("(prefers-color-scheme: dark)");
      const applyTheme=(useDark:boolean)=>{setDark(useDark);document.documentElement.dataset.theme=useDark?"dark":"light";};
      applyTheme(pref?pref==="dark":mq.matches);
      const onSystem=(e:MediaQueryListEvent)=>{if(!localStorage.getItem(THEME_KEY))applyTheme(e.matches);};
      mq.addEventListener("change",onSystem);
      themeCleanup.current=()=>mq.removeEventListener("change",onSystem);
    }catch(err){console.warn("Stored prototype content was not usable",err);}
    try{localStorage.setItem(SCHED_HASH_KEY,hashStr(JSON.stringify(SEED.schedule)));}catch(err){}
    setHydrated(true);
  },[]);
  useEffect(()=>()=>{themeCleanup.current?.();},[]);
  // Public read-only server layer: if a database is configured, published content from
  // PostgreSQL overrides the prototype data for display; localStorage stays untouched.
  useEffect(()=>{
    if(!hydrated)return;
    let cancelled=false;
    fetch(`/api/public/content?type=all&section=${section}`,{cache:"no-store"})
      .then(r=>r.json())
      .then(j=>{
        if(cancelled||!j||j.fromDatabase!==true||!j.content)return;
        fromServer.current=true;
        updateData(prev=>({...prev,...mapPublicContent(j.content)}));
      })
      .catch(()=>{});
    return ()=>{cancelled=true;};
  },[hydrated,section]);
  useEffect(()=>{if(hydrated&&!fromServer.current)localStorage.setItem(STORE_KEY,JSON.stringify(data));},[data,hydrated]);
  useEffect(()=>{if(hydrated)localStorage.setItem(SECTION_KEY,section);},[section,hydrated]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?"dark":"light";},[dark]);
  const setData=useCallback((updater:(current:PortalData)=>PortalData)=>updateData(prev=>updater(prev)),[]);
  const reset=useCallback(()=>{updateData(SEED);},[]);
  const toggleDark=useCallback(()=>setDark(v=>{const next=!v;try{localStorage.setItem(THEME_KEY,next?"dark":"light");}catch(err){}return next;}),[]);
  const value=useMemo(()=>({data,setData,section,setSection:updateSection,dark,toggleDark,reset,hydrated}),[data,setData,section,dark,toggleDark,reset,hydrated]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePortal(){const ctx=useContext(Context);if(!ctx)throw new Error("PortalProvider missing");return ctx;}
