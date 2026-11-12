"use client";

import {useEffect, useId, useRef, useState} from "react";
import type {PublicationIssue, PublicationOptions} from "@/lib/server/publication-dedup";

type Result = {cancelled?: boolean; ok?: boolean; error?: string; issue?: PublicationIssue; id?: string; url?: string; action?: "expanded" | "updated"};

type Row = Record<string, unknown>;
type Preview = {type: string; row: Row; subject?: string; attachment?: string; queuesTelegram: boolean; pendingDeduplication: boolean};
const PREVIEW_TYPES = ["lectures", "announcements", "assignments", "exams"];
const HEADERS = {"content-type": "application/json", "x-portal-admin": "1"};

function visibleAudience(row: Row, type: string) {
  const sections = type === "announcements"
    ? row.scope === "general" || !row.scope || row.section === "all" ? [] : [String(row.section || "")].filter(Boolean)
    : Array.isArray(row.sections) ? row.sections.map(String) : [];
  return sections.length === 0 || sections.length === 4 ? "كل الشعب" : sections.join("، ");
}

function PreviewCard({draft}: {draft: Preview}) {
  const {type, row} = draft;
  const text = String(row.body || row.instructions || row.description || row.topics || "");
  const day = String(row.due_at || row.date || "").slice(0, 10);
  const time = type === "exams" ? String(row.start_time || "") : "";
  const attachment = draft.attachment || String(row.file_name || (row.attachment_url || row.file_url ? "مرفق" : ""));
  return <article className="panel admin-preview-card">
    <div className="panel-heading"><div><h3>{String(row.title || "")}</h3>{draft.subject && <p className="subtle small">{draft.subject}</p>}</div></div>
    <div className="panel-body stack">
      {text && <p className="admin-preview-text">{text}</p>}
      {day && <div className="kv"><span>{type === "assignments" ? "آخر يوم للتسليم" : "الموعد · توقيت بغداد"}</span><strong dir="ltr">{day}{time && " · " + time}</strong></div>}
      {typeof row.room === "string" && row.room && <div className="kv"><span>القاعة</span><strong>{row.room}</strong></div>}
      {typeof row.submission === "string" && row.submission && <div className="kv"><span>طريقة التسليم</span><strong>{row.submission}</strong></div>}
      {typeof row.notes === "string" && row.notes && <p className="admin-preview-text">{row.notes}</p>}
      {attachment && <div className="kv"><span>المرفق</span><strong>{attachment}</strong></div>}
    </div>
  </article>;
}

export function usePublicationRequest() {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const resolveReview = useRef<((options: PublicationOptions | null) => void) | null>(null);
  const resolvePreview = useRef<((accepted: boolean) => void) | null>(null);
  const inFlight = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issue, setIssue] = useState<PublicationIssue | null>(null);

  useEffect(() => {
    if ((preview || issue) && !dialog.current?.open) dialog.current?.showModal();
  }, [preview, issue]);

  useEffect(() => () => {
    resolvePreview.current?.(false);
    resolveReview.current?.(null);
  }, []);

  function finishPreview(accepted: boolean) {
    dialog.current?.close();
    resolvePreview.current?.(accepted);
    resolvePreview.current = null;
    setPreview(null);
  }

  function finish(options: PublicationOptions | null) {
    dialog.current?.close();
    resolveReview.current?.(options);
    resolveReview.current = null;
    setIssue(null);
  }

  async function request(type: string, row: Row, details?: {subject?: string; attachment?: string; prepare?: () => Promise<Row>; editing?: boolean}) {
    if (inFlight.current) return {response: new Response(null, {status: 409}), data: {cancelled: true} as Result};
    inFlight.current = true;
    try {
      if (PREVIEW_TYPES.includes(type) && !details?.editing) {
        const response = await fetch("/api/admin/content", {
          method: "POST", headers: HEADERS, body: JSON.stringify({type, row, preview: true}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return {response, data: data as Result};
        const accepted = await new Promise<boolean>(resolve => {
          resolvePreview.current = resolve;
          setPreview({type, row, subject: details?.subject, attachment: details?.attachment,
            queuesTelegram: data.queuesTelegram === true, pendingDeduplication: data.pendingDeduplication === true});
        });
        if (!accepted) return {response: new Response(null, {status: 409}), data: {cancelled: true} as Result};
      }
      const payload = details?.prepare ? await details.prepare() : row;
      let publication: PublicationOptions = {};
      for (;;) {
        const response = await fetch("/api/admin/content", {
          method: "POST", headers: HEADERS, body: JSON.stringify({type, row: payload, publication}),
        });
        const data: Result = await response.json().catch(() => ({}));
        if (response.status !== 409 || !data.issue) return {response, data};
        const options = await new Promise<PublicationOptions | null>(resolve => {
          resolveReview.current = resolve;
          setIssue(data.issue!);
        });
        if (!options) return {response, data};
        publication = options;
      }
    } finally {
      inFlight.current = false;
    }
  }

  const review = <dialog ref={dialog} className="panel" aria-labelledby={titleId}
    style={{maxWidth: "min(30rem, calc(100% - 2rem))", margin: "auto", padding: 20}}
    onCancel={event => {event.preventDefault(); if (preview) finishPreview(false); else finish(null);}}>
    {preview && <>
      <h2 id={titleId}>معاينة قبل النشر</h2>
      <p><strong>يظهر إلى</strong> <bdi>{visibleAudience(preview.row, preview.type)}</bdi></p>
      <PreviewCard draft={preview}/>
      <p className="subtle small">{preview.queuesTelegram
        ? preview.pendingDeduplication
          ? "يُدرج إشعار تيليجرام للإرسال إذا نتج عن فحص التكرار نشر جديد. وقد يُرسل للشعب المضافة فقط عند توسيع نشر ملف."
          : "يُدرج إشعار تيليجرام للإرسال بعد نجاح النشر."
        : "لن يُدرج إشعار نشر جديد في تيليجرام."}</p>
      <div className="admin-actions">
        <button type="button" className="action-button" onClick={() => finishPreview(true)}>تأكيد النشر</button>
        <button type="button" className="action-button secondary" onClick={() => finishPreview(false)}>رجوع للتعديل</button>
      </div>
    </>}
    {issue && <>
      <h2 id={titleId}>{issue.kind === "duplicate" ? "منشور مسبقًا" : issue.kind === "expand" ? "نشر للشعب الإضافية؟" : "يوجد منشور مشابه"}</h2>
      <p>{issue.title}</p>
      {issue.kind === "expand" && <p>الشعب الإضافية: <bdi>{issue.addedSections?.join("، ")}</bdi></p>}
      <p><a className="text-link" href={issue.url} target="_blank" rel="noreferrer">فتح المنشور الموجود</a></p>
      <div className="actions" style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
        {issue.kind === "expand" && <button type="button" className="action-button" onClick={() => finish({expand: issue.id})}>نشر للشعب الإضافية</button>}
        {issue.kind === "similar" && issue.canUpdate && <button type="button" className="action-button" onClick={() => finish({replace: issue.id})}>تحديث المنشور الموجود</button>}
        {issue.kind === "similar" && <button type="button" className="action-button secondary" onClick={() => finish({reviewed: issue.id})}>نشر كمنشور جديد</button>}
        <button type="button" className="action-button secondary" onClick={() => finish(null)}>{issue.kind === "duplicate" ? "إغلاق" : "إلغاء"}</button>
      </div>
    </>}
  </dialog>;

  return {request, review};
}
