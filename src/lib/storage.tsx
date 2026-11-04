"use client";
import React, {createContext,useCallback,useContext,useEffect,useMemo,useState} from "react";
import {SEED,SECTIONS} from "./seed";
import type {PortalData,Section} from "./types";

type State = { data:PortalData; setData:(updater:(current:PortalData)=>PortalData)=>void; section:Section; setSection:(value:Section)=>void; dark:boolean; toggleDark:()=>void; reset:()=>void; hydrated:boolean };
const Context=createContext<State|null>(null);
const STORE_KEY="dijlah-stage3-prototype-data-v2";
const SECTION_KEY="dijlah-stage3-section";
const THEME_KEY="dijlah-stage3-theme";

export function PortalProvider({children}:{children:React.ReactNode}){
  const [data,updateData]=useState<PortalData>(SEED);
  const [section,updateSection]=useState<Section>("A");
  const [dark,setDark]=useState(false);
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>{
    try {
      const stored=localStorage.getItem(STORE_KEY);
      if(stored){const parsed=JSON.parse(stored) as Partial<PortalData>; updateData({...SEED,...parsed,telegram:{...SEED.telegram,...parsed.telegram,sections:{...SEED.telegram.sections,...parsed.telegram?.sections}}});}
      const sel=localStorage.getItem(SECTION_KEY);
      if(SECTIONS.includes(sel as Section))updateSection(sel as Section);
      setDark(localStorage.getItem(THEME_KEY)==="dark");
    }catch(err){console.warn("Stored prototype content was not usable",err);}
    setHydrated(true);
  },[]);
  useEffect(()=>{if(hydrated)localStorage.setItem(STORE_KEY,JSON.stringify(data));},[data,hydrated]);
  useEffect(()=>{if(hydrated)localStorage.setItem(SECTION_KEY,section);},[section,hydrated]);
  useEffect(()=>{if(hydrated)localStorage.setItem(THEME_KEY,dark?"dark":"light");document.documentElement.dataset.theme=dark?"dark":"light";},[dark,hydrated]);
  const setData=useCallback((updater:(current:PortalData)=>PortalData)=>updateData(prev=>updater(prev)),[]);
  const reset=useCallback(()=>{updateData(SEED);},[]);
  const value=useMemo(()=>({data,setData,section,setSection:updateSection,dark,toggleDark:()=>setDark(v=>!v),reset,hydrated}),[data,setData,section,dark,reset,hydrated]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePortal(){const ctx=useContext(Context);if(!ctx)throw new Error("PortalProvider missing");return ctx;}
