"use client";

import {useEffect, useRef, useState} from "react";
import {ChevronDown, ChevronUp, Download, ExternalLink, Loader2, Maximize, Minimize, ZoomIn, ZoomOut} from "lucide-react";

type Pdfjs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

function PdfPage({pdf, number, width, ratio, root}: {pdf: PdfDocument; number: number; width: number; ratio: number; root: HTMLDivElement}) {
  const element = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageRatio, setPageRatio] = useState<number>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {root, rootMargin: "450px"});
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PdfDocument["getPage"]>>["render"]> | undefined;
    setFailed(false);
    void pdf.getPage(number).then(async page => {
      if (cancelled) return;
      const base = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: width / base.width});
      setPageRatio(base.width / base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (viewport.width * viewport.height)));
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      task = page.render({canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0]});
      await task.promise;
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, number, visible, width]);

  return <div ref={element} className="pdf-page" data-page={number} style={{width, aspectRatio: pageRatio || ratio}}>
    {visible && <canvas ref={canvasRef} className="pdf-canvas" role="img" aria-label={`صفحة ${number}`}/>}
    {failed && <p className="pdf-state error">تعذّر عرض هذه الصفحة. يمكنك فتح الملف مباشرة.</p>}
  </div>;
}

export default function PdfViewer({src, fileName}: {src: string; fileName?: string}) {
  const [documentData, setDocumentData] = useState<{pdf: PdfDocument; ratio: number}>();
  const [failed, setFailed] = useState(false);
  const [pages, setPages] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<Pdfjs["getDocument"]> | undefined;
    setDocumentData(undefined);
    setFailed(false);
    setPage(1);
    setZoom(1);
    void import("pdfjs-dist").then(async lib => {
      if (cancelled) return;
      lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = lib.getDocument({url: src});
      const pdf = await task.promise;
      const first = (await pdf.getPage(1)).getViewport({scale: 1});
      if (!cancelled) setDocumentData({pdf, ratio: first.width / first.height});
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; void task?.destroy().catch(() => {}); };
  }, [src]);

  useEffect(() => {
    if (!pages) return;
    const measure = () => setWidth(Math.max(1, Math.min(900, pages.clientWidth - 28)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pages);
    return () => observer.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); };
  }, [fullscreen]);

  const count = documentData?.pdf.numPages || 0;
  function goTo(number: number) {
    if (number < 1 || number > count || !pages) return;
    const target = pages.querySelector<HTMLElement>(`[data-page="${number}"]`);
    if (target) pages.scrollTop += target.getBoundingClientRect().top - pages.getBoundingClientRect().top - 10;
    setPage(number);
  }

  function trackPage() {
    if (!pages) return;
    const top = pages.getBoundingClientRect().top;
    const current = Array.from(pages.children).find(item => item.getBoundingClientRect().bottom > top + 24);
    if (current instanceof HTMLElement) setPage(Number(current.dataset.page) || 1);
  }

  function changeZoom(value: number) {
    const current = page;
    setZoom(value);
    requestAnimationFrame(() => goTo(current));
  }

  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    if (new URL(src, window.location.href).origin === window.location.origin) return;
    event.preventDefault();
    if (downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || "document.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return <div className={`pdf-viewer-wrap${fullscreen ? " pdf-expanded" : ""}`}>
    <div className="pdf-reader-tools">
      <div className="pdf-tool-row">
        <strong className="pdf-filename" dir="auto">{fileName || "ملف PDF"}</strong>
        <a className="action-button" href={src} download={fileName || true} onClick={download}><Download size={16}/> {downloading ? "جارٍ التحميل…" : "تحميل PDF"}</a>
        <a className="icon-button" href={src} target="_blank" rel="noopener noreferrer" aria-label="فتح الملف مباشرة" title="فتح الملف مباشرة"><ExternalLink size={17}/></a>
      </div>
      {count > 0 && <div className="pdf-tool-row pdf-controls">
        <button type="button" className="icon-button" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="الصفحة السابقة"><ChevronUp size={18}/></button>
        <span className="pdf-page-ind">صفحة <bdi>{page} / {count}</bdi></span>
        <button type="button" className="icon-button" onClick={() => goTo(page + 1)} disabled={page >= count} aria-label="الصفحة التالية"><ChevronDown size={18}/></button>
        <button type="button" className="icon-button" onClick={() => changeZoom(Math.max(1, zoom - .25))} disabled={zoom <= 1} aria-label="تصغير"><ZoomOut size={18}/></button>
        <button type="button" className="icon-button" onClick={() => changeZoom(Math.min(3, zoom + .25))} disabled={zoom >= 3} aria-label="تكبير"><ZoomIn size={18}/></button>
        <button type="button" className="icon-button" onClick={() => setFullscreen(value => !value)} aria-label={fullscreen ? "تصغير القارئ" : "ملء الشاشة"}>{fullscreen ? <Minimize size={18}/> : <Maximize size={18}/>}</button>
      </div>}
      {downloadError && <p role="status">تعذّر التحميل المباشر. <a href={src} target="_blank" rel="noopener noreferrer">افتح الملف واحفظه من المتصفح</a>.</p>}
    </div>
    {!documentData && (failed ? <p role="alert" className="pdf-state error">تعذّر عرض الملف هنا. استخدم زر فتح الملف أو التحميل.</p> : <div className="pdf-state" role="status"><Loader2 size={26} className="spin"/> جارٍ تحميل المستند…</div>)}
    {documentData && <div className="pdf-pages" ref={setPages} dir="ltr" onScroll={trackPage}>
      {width > 0 && pages && Array.from({length: count}, (_, index) => <PdfPage key={index} pdf={documentData.pdf} ratio={documentData.ratio} number={index + 1} width={Math.round(width * zoom)} root={pages}/>)}
    </div>}
  </div>;
}
