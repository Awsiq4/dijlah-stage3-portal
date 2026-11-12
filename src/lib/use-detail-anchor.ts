"use client";

import {useEffect} from "react";

/** Scroll after asynchronously loaded content mounts. */
export function useDetailAnchor(rows: unknown, day?: number, view?: string) {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView({block: "start"});
    } catch {
      // Malformed URL fragments have no corresponding element.
    }
  }, [rows, day, view]);
}
