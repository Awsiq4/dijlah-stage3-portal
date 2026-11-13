# PROJECT_INVENTORY.md — جرد المشروع (main @ f219ba7)
**تاريخ التدقيق:** 2026-11-13 · **الفرع:** main @ f219ba79637f522b2fc0aeb926ea10cd1887e068 · **CI:** success · **Vercel status على نفس الـsha:** success

## البنية
- Next.js 15 + React 19 + TypeScript (strict) · pg (Neon) · pdfjs-dist · lucide-react · Cairo font
- 213 ملفاً متتبعها git · 20 صفحة · 24 API route · 21 ملف lib · 7 components · 13 سكربت · 5 ملفات SQL · 11 ملف اختبار

## صفحات الموقع (src/app)
/ (الرئيسية) · /subjects · /subjects/[id] · /lectures/[id] · /questions/[id] · /schedule · /this-week · /announcements · /assignments · /exams · /notifications · /more · /support · /about-department · /admin · /admin/login · /admin/setup · /admin/forgot-password · /admin/reset-password · /admin/passkeys · /admin-legacy

## API routes (src/app/api)
public/content · health · passkeys · support · support/entry · admin/{login,logout,me,setup,stats,content,upload,users,audit,request-password-reset,reset-password} · telegram/{webhook,subscribe,link,health,admin,worker}

## الجداول (قاعدة البيانات — تم التحقق منها مباشرة على Neon test)
portal_admins, portal_sessions, portal_login_attempts, portal_invitations, portal_link_tokens, portal_subjects, portal_lectures, portal_announcements, portal_exams, portal_assignments, portal_schedule, portal_telegram, portal_telegram_links, portal_audit, portal_bot_state, portal_publication_locks, tg_subscribers, tg_events, tg_deliveries, tg_audit, tg_owner_notifs, tg_student_activity, tg_student_section_changes, bot_settings

## أدوار الصلاحيات (rbac.ts)
super_admin · teacher · general_representative · section_representative · student (+ viewer/editor legacy) · OWNER عبر BOT_OWNER_ID (على مستوى البوت)

## أوامر البوت
/start /menu /help /section /settings /status /stop /privacy /admin + callback prefixes: own: stu: nav: flow: adm: ann: lec: pub: draft: edit: it: page: sec: pref: quiz: q: qmanage: exam: asg: cw: sup: o:

## أنواع الإشعارات (notify.ts)
announcements · lectures · exams · assignments · schedule (+ أحداث المالك: تسجيل مستخدم جديد)
