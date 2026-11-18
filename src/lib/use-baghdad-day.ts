"use client";

import {useEffect, useState} from "react";
import {baghdadToday} from "./assignment-date";

export function useBaghdadDay(): string {
  const [day, setDay] = useState(baghdadToday);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const now = new Date();
      const today = baghdadToday(now);
      setDay(today);
      // Baghdad is UTC+3 year-round. Recheck as soon as the next local day begins.
      const tomorrow = Date.parse(`${today}T00:00:00+03:00`) + 24 * 60 * 60 * 1000;
      timer = setTimeout(refresh, tomorrow - now.getTime());
    }

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return day;
}
