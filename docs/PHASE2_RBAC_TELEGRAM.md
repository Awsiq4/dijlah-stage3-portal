# Phase 2 — RBAC + لوحات حسب الدور + نشر عبر Telegram (PR #13 فقط)

## 1. نموذج الأدوار (server-side فقط)
`src/lib/server/rbac.ts` — الأدوار: `super_admin` · `editor` · `viewer` · `general_representative` · `section_representative` · `teacher`

- `canManageUsers` → super_admin فقط.
- `canPublishAnnouncement` → section_representative: شعبته فقط؛ general_representative: scope=general فقط.
- `canPublishSubjectContent` → teacher: المواد المسندة + الشعب المسموح بها (`perms.teacher_sections`).
- `canModifyContent` → المالك (created_by) أو الأدوار المميزة.
- الحسابات المعلّقة (`status='suspended'`) تُرفض من كل المسارات فورًا (جلسات + روابط Telegram تُسحب).

## 2. هجرة قاعدة البيانات — `database/portal-rbac.sql` (idempotent، غير destructive)
- توسيع `portal_admins` (name/status/assigned_section/assigned_subjects/perms + constraint الأدوار الجديدة)
- أعمدة `created_by` + `source` (web|telegram) على جداول المحتوى
- جداول جديدة: `portal_invitations` · `portal_link_tokens` · `portal_telegram_links` · `portal_bot_state`

**التطبيق:** عبر Neon MCP (`prepare_database_migration` → review → `complete_database_migration`) أو `psql "$DATABASE_URL" -f database/portal-rbac.sql`. لا تُعيد تشغيل الهجرات destructive.

## 3. invitations (دعوات accounts)
- Super Admin → «إدارة الحسابات» → إضافة مستخدم → رابط تفعيل `…/admin/setup?token=…` يُعرض مرة واحدة.
- الـtoken مخزَّن hash (SHA-256)، صالح 7 أيام، single-use. صفحة `/admin/setup` تعيّن كلمة المرور (≥12) وتنشئ الجلسة.
- `/api/admin/setup` public لكن محمي بـrate limit؛ `/api/admin/users` (GET/POST/PATCH) super_admin فقط مع CSRF وtx وaudit.

## 4. ربط Telegram
- `/api/telegram/link` POST → deep link `https://t.me/<bot>?start=link_<signed payload>` (HMAC، 10 دقائق، مرة واحدة، مخزن hash).
- البوت يربط `telegram_user_id` بالحساب (`portal_telegram_links`)، معataires فورية عند التعليق. لا يُعتمد username أبدًا.

## 5. النشر المشترك (Web + Bot = نفس الـbackend)
`src/lib/server/publish.ts` — `publishAnnouncement` / `publishLecture` / `publishExam` / `publishAssignment`:
فحص صلاحيات server-side → sanitize (allowlists) → معاملة واحدة (insert + ownership + audit) → إشعار (tg_events) فقط إن كان البوت مفعّلًا.
- البوت: `src/lib/server/bot.ts` — حالة المحادثة في `portal_bot_state` (تبقى بعد restart)، قوائم inline، معاينة، تأكيد، إعادة فحص الصلاحيات قبل النشر، idempotency (`ON CONFLICT DO NOTHING`).
- Webhook موسّع: `/start link_…` للربط، وcallbacks `adm:`/`lec:`/`pub:` للنشر.

## 6.Dashboards حسب الدور (RTL، فاتح/داكن، mobile-first)
- super_admin: كل التبويبات + «إدارة الحسابات والصلاحيات» + «مركز Telegram»
- section/general representative: نموذج نشر تبليغ بسيط (3-5 نقرات)
- teacher: إضافة محاضرة (مادة/رقم/عنوان/رابط PDF)  + محتوياته
- `/api/admin/content` يفرض scope + ownership للأدوار غير المميزة.

## 7. CSRF على Preview
`PORTAL_ALLOWED_ORIGINS` (comma-separated) يُضاف إلى `csrfWriteOk` بجانب `PORTAL_BASE_URL` — اضبط `PORTAL_BASE_URL` على رابط الـpreview في بيئة الـpreview.

## 8. اختبارات الأمان (rbac.test.mjs — 8 سيناريوهات)
S1 rep A لا ينشر لـB · S2 teacher بدون مادة/شعبة غير مسموح · S3 فقط super_admin يدير المستخدمين · S4 معلّق لا ينشر · S5 tokens منتهية/مستخدمة · S6 payloads Telegram مزيفة مرفوضة · S7 عدم تكرار النشر · S8 السوبر admin intact.

## 9. حدود حالية
- رفع PDF عبر البوت غير مدعوم (Telegram file limits) → بديل آمن: رفع من اللوحة وإرسال الرابط.
- الإشعارات معطّلة افتراضيًا (`TELEGRAM_BOT_ENABLED=false`)؛ لا يوجد مرسلون حتى — اختبار controlled first.
- لم يُتحقق E2E على Neon من هنا (أدوات Neon/Vercel غير قابلة للاستدعاء من هذه الجلسة) — يُشغَّل `npm run test:e2e` بعد تطبيق الهجرة.

## 10. إصلاحات جولة المراجعة (Review fixes)

1. **gate الكتابة الموحد**: `/api/admin/content` يستخدم الآن `canWriteContentRecord` (من rbac.ts) — الممثل/التدريسي ينشر ضمن نطاقه فقط؛ لم يعد يعتمد على canModify الذي كان يحصر الكتابة على super_admin/editor.
2. **رابط Telegram قصير**: `/start link_<16-char token>` —apt cantidad ≤64 حرفًا؛ الـtoken عشوائي قصير، مؤقت (10 دقائق)، واحد الاستخدام، مخزن hash فقط (SHA-256) ويُبحث به مباشرة.
3. **رفع PDF حقيقي**: `/api/admin/upload` (من الهاتف/الويب) + تدفق `document` في البوت — تحقق magic bytes `%PDF-` وحد 20MB → رفع إلى Vercel Blob (`BLOB_READ_WRITE_TOKEN`) → url محفوظ في سجل المحاضرة.
4. **فحص الملكية داخل المعاملة**: تحديث أي محتوى موجود يمر عبر `assertUpdateAllowed` داخل `withTx` (SELECT created_by → canModifyContent → 403)، والحذف بنفس الفحص.
5. **Webhook مشدد**: `webhookAuthorized()` — `TELEGRAM_BOT_ENABLED=false` → تجاهل كل التحديثات؛ عند التفعيل مفتاح `X-Telegram-Bot-Api-Secret-Token` إلزامي (غيابه = رفض 401 لكل شيء).
6. **قائمة مواد عربية**: nmnconst من `/api/public/content?type=subjects` checkboxes بأسماء المواد من قاعدة البيانات.
7. **اختبارات نشر حقيقية (pg-mem)**: publish.test.mjs — ممثل A ينشر لشعبته فقط (B مرفوض وغير محفوظ)، Ustadh ضمن مادته وشعبه فقط، معلّق مرفوض، الملكية، audit trail. rbac.test.mjs — gate الكتابة + webhook + link token length. **53/53 pass**.

## 11. إعدادات بيئة Preview (فقط ♄لـPreview — ليس Production أبدًا)

هذه المتغيرات تُضبط **فقط** في custom environment الخاص بفرع `vibe/phase1-secure-backend-fbb429` (أو عبر `npm run setup:vercel-env` الذي يستهدف هذا الـenvironment فقط):
- `PORTAL_BASE_URL` = رابط الـPreview (يستخدم في فحص CSRF origin)
- `PORTAL_ALLOWED_ORIGINS` = origins إضافية مفصولة بفواصل (اختياري)
- `BLOB_READ_WRITE_TOKEN` = من Vercel → Storage → Blob (لرفع PDF المباشر؛ بدونه للرفع المباشر؛ بدونه يمكن رفع ملفات أكبر من 20MB عبر البوت فقط
- `DATABASE_URL` / `SESSION_SECRET` / `ADMIN_API_SECRET` / `TELEGRAM_BOT_ENABLED=false`
لا تُعيّن أيًا منها في Production. `scripts/vercel-set-env.mjs` لا ي Vita Production أبدًا.
