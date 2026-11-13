# PERFORMANCE_REPORT.md
- TTFB production (dj3.top, 11 صفحة): 157–1050ms — PASS (T07)
- Load محلي معزول (main build): 200 متزامناً → 0 errors, p50=162ms, p95=274ms, p99=290ms (صفحة) / p95=334ms (API) — PASS (T12)
- BLOCKED: 200 على الإنتاج (ممنوع)، Vercel analytics (T21)
- لا يوجد "جارٍ التحميل" بلا نهاية: verify-structure + build — PASS
