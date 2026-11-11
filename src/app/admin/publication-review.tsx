"use client";

import {useEffect, useRef, useState} from "react";
import type {PublicationIssue, PublicationOptions} from "@/lib/server/publication-dedup";

type Result = {ok?: boolean; error?: string; issue?: PublicationIssue; id?: string; url?: string; action?: "expanded" | "updated"};

export function usePublicationRequest() {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolveReview = useRef<((options: PublicationOptions | null) => void) | null>(null);
  const [issue, setIssue] = useState<PublicationIssue | null>(null);

  useEffect(() => {
    if (issue && !dialog.current?.open) dialog.current?.showModal();
  }, [issue]);

  function finish(options: PublicationOptions | null) {
    dialog.current?.close();
    resolveReview.current?.(options);
    resolveReview.current = null;
    setIssue(null);
  }

  async function request(type: string, row: Record<string, unknown>) {
    let publication: PublicationOptions = {};
    for (;;) {
      const response = await fetch("/api/admin/content", {
        method: "POST", headers: {"content-type": "application/json", "x-portal-admin": "1"},
        body: JSON.stringify({type, row, publication}),
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
  }

  const review = <dialog ref={dialog} className="panel" aria-labelledby="publication-review-title"
    style={{maxWidth: "min(30rem, calc(100% - 2rem))", margin: "auto", padding: 20}}
    onCancel={event => {event.preventDefault(); finish(null);}}>
    {issue && <>
      <h2 id="publication-review-title">{issue.kind === "duplicate" ? "منشور مسبقًا" : issue.kind === "expand" ? "نشر للشعب الإضافية؟" : "يوجد منشور مشابه"}</h2>
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
