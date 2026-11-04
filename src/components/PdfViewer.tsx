"use client";
import React,{useCallback,useEffect,useRef,useState} from "react";
import {ChevronDown,ChevronUp,Download,ExternalLink,Loader2,Maximize,Minimize,X,ZoomIn,ZoomOut} from "lucide-react";

type Pdfjs = typeof import("pdfjs-dist");

export default function PdfViewer({src,fileName,onClose}:{src:string;fileName?:string;onClose?:()=>void}){
  const [pdfjs,setPdfjs]=useState<Pdfjs|null>(null);
  const [doc,setDoc]=useState<{numPages:number}|null>(null);
  const [page,setPage]=useState(1);
  const [zoom,setZoom]=useState(1);
  const [status,setStatus]=useState<"loading"|"ready"|"error">("loading");
  const [error,setError]=useState("");
  const [fullscreen,setFullscreen]=useState(false);
  const wrapRef=useRef<HTMLDivElement>(null);
  const pagesRef=useRef<HTMLDivElement>(null);
  const docRef=useRef<Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>|null>(null);
  const renderTasks=useRef(new Set<unknown>());
  const pinchRef=useRef<{d:number;z:number}|null>(null);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const lib: Pdfjs=await import("pdfjs-dist");
        lib.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
        if(cancelled)return;
        setPdfjs(lib);
        const task=lib.getDocument({url:src});
        const d=await task.promise;
        if(cancelled){task.destroy();return;}
        docRef.current=d;
        setDoc({numPages:d.numPages});
        setStatus("ready");
      }catch(err){
        if(!cancelled){setStatus("error");setError(err instanceof Error?err.message:"تعذّر تحميل الملف");}
      }
    })();
    return()=>{cancelled=true;(docRef.current as unknown as {destroy?:()=>void})?.destroy?.();renderTasks.current.forEach((t)=>{(t as {cancel?:()=>void}).cancel?.();});renderTasks.current.clear();};
  },[src]);

  const renderPage=useCallback(async(p:number)=>{
    if(!pdfjs||!docRef.current)return;
    const holder=pagesRef.current?.querySelector(`[data-page="${p}"]`);
    if(!holder||holder.querySelector("canvas"))return;
    const canvas=document.createElement("canvas");
    canvas.className="pdf-canvas";
    holder.appendChild(canvas);
    try{
      const pg=await docRef.current.getPage(p);
      const base=pg.getViewport({scale:1});
      const holderW=holder.clientWidth||300;
      const scale=(holderW*zoom)/base.width;
      const viewport=pg.getViewport({scale});
      const dpr=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.floor(viewport.width*dpr);
      canvas.height=Math.floor(viewport.height*dpr);
      canvas.style.width=`${Math.floor(viewport.width)}px`;
      canvas.style.height=`${Math.floor(viewport.height)}px`;
      const task=pg.render({canvas,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined});
      renderTasks.current.add(task);
      await task.promise;
      renderTasks.current.delete(task);
    }catch{/* page render cancelled */}
  },[pdfjs,zoom]);

  useEffect(()=>{
    if(status!=="ready"||!doc)return;
    let raf=0;
    const io=new IntersectionObserver(entries=>{
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{
        for(const e of entries)if(e.isIntersecting)renderPage(Number((e.target as HTMLElement).dataset.page));
      });
    },{root:pagesRef.current,rootMargin:"600px"});
    pagesRef.current?.querySelectorAll("[data-page]").forEach(el=>io.observe(el));
    return()=>{io.disconnect();cancelAnimationFrame(raf);};
  },[status,doc,renderPage]);

  useEffect(()=>{
    if(status!=="ready")return;
    const holders=pagesRef.current?.querySelectorAll("[data-page]")||[];
    for(const h of holders){
      const p=Number((h as HTMLElement).dataset.page);
      const canvas=h.querySelector("canvas");
      if(canvas&&Math.abs((canvas as HTMLCanvasElement).width/ (window.devicePixelRatio||1) - 0)>0){/* rerender on zoom */}
      if(!canvas)renderPage(p);
      else renderPage(p);
    }
  },[zoom,status,renderPage]);

  const goTo=useCallback((p:number)=>{
    const n=Math.min(Math.max(1,p),doc?.numPages||1);
    setPage(n);
    pagesRef.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({behavior:"smooth",block:"start"});
  },[doc]);

  const toggleFullscreen=useCallback(async()=>{
    try{
      if(!document.fullscreenElement){await wrapRef.current?.requestFullscreen();setFullscreen(true);}
      else{await document.exitFullscreen();setFullscreen(false);}
    }catch{/* fullscreen unsupported */}
  },[]);

  useEffect(()=>{
    const onFs=()=>setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange",onFs);
    return()=>document.removeEventListener("fullscreenchange",onFs);
  },[]);

  const onTouchStart=useCallback((e:React.TouchEvent)=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY;
      pinchRef.current={d:Math.hypot(dx,dy),z:zoom};
    }
  },[zoom]);
  const onTouchMove=useCallback((e:React.TouchEvent)=>{
    if(e.touches.length===2&&pinchRef.current){
      const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY;
      const d=Math.hypot(dx,dy);
      if(pinchRef.current.d>0)setZoom(Math.min(3,Math.max(0.5,pinchRef.current.z*(d/pinchRef.current.d))));
    }
  },[]);

  const zoomStep=(dir:number)=>setZoom(z=>Math.min(3,Math.max(0.5,Math.round((z+dir*0.25)*100)/100)));

  return <div className="pdf-viewer-wrap" ref={wrapRef}>
    <div className="pdf-toolbar">
      <strong className="grow">{fileName||"ملف PDF"}</strong>
      {status==="ready"&&doc&&<span className="pdf-page-ind" aria-live="polite">صفحة {page} / {doc.numPages}</span>}
      {status==="ready"&&<>
        <button type="button" className="icon-button sm" onClick={()=>goTo(page-1)} disabled={page<=1} aria-label="الصفحة السابقة"><ChevronUp size={17}/></button>
        <button type="button" className="icon-button sm" onClick={()=>goTo(page+1)} disabled={page>=(doc?.numPages??1)} aria-label="الصفحة التالية"><ChevronDown size={17}/></button>
        <button type="button" className="icon-button sm" onClick={()=>zoomStep(-1)} aria-label="تصغير"><ZoomOut size={17}/></button>
        <span className="pdf-zoom">{Math.round(zoom*100)}%</span>
        <button type="button" className="icon-button sm" onClick={()=>zoomStep(1)} aria-label="تكبير"><ZoomIn size={17}/></button>
        <button type="button" className="icon-button sm" onClick={toggleFullscreen} aria-label={fullscreen?"الخروج من ملء الشاشة":"ملء الشاشة"}>{fullscreen?<Minimize size={17}/>:<Maximize size={17}/>}</button>
      </>}
      <a className="icon-button sm" href={src} download={fileName||true} aria-label="تحميل الملف" title="تحميل"><Download size={17}/></a>
      <a className="icon-button sm" href={src} target="_blank" rel="noopener noreferrer" aria-label="فتح في نافذة جديدة" title="فتح خارجي"><ExternalLink size={17}/></a>
      {onClose&&<button type="button" className="icon-button sm" onClick={onClose} aria-label="إغلاق"><X size={17}/></button>}
    </div>
    {status==="loading"&&<div className="pdf-state"><Loader2 size={26} className="spin"/><p>جارٍ تحميل المستند…</p></div>}
    {status==="error"&&<div className="pdf-state error"><p>تعذّر عرض المستند: {error}</p><a className="action-button" href={src} download={fileName||true}><Download size={16}/> تحميل الملف مباشرة</a></div>}
    <div className="pdf-pages" ref={pagesRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      {status==="ready"&&doc&&Array.from({length:doc.numPages},(_,i)=>i+1).map(p=>
        <div className="pdf-page" key={p} data-page={p}/>
      )}
    </div>
  </div>;
}
