# المرحلة الأولى — أساس خلفي آمن (Phase 1: Secure Backend Foundation)

تاريخ: 2026-11-04 · الفرع: `vibe/phase1-secure-backend-fbb429` · الحالة: Preview — لا يُدمج في `main` إلا بطلب صريح.

> واجهة الطلاب العامة لم تتغير. كل الإضافات محصورة في `/admin` و`/api/admin` و`/api/telegram` وقاعدة البيانات.

## 1. تدقيق البنية الحالية (Audit)

### لوحة الإدارة قبل المرحلة الأولى
- `/admin` صفحة prototype client-side بدون أي مصادقة حقيقية؛ أي زائر يمكنه تعديل المحتوى المحلي.
- لا توجد أدوار، ولا جلسات، ولا سجلات تدقيق، ولا حماية server-side.

### خدمة إشعارات التليجرام (PR #12)
- معمارية server-side صحيحة: webhook محمي بـ `X-Telegram-Bot-Api-Secret-Token`، اشتراكات في Postgres (`database/telegram-notifications.sql`)، توصيل عبر QStash اختياري، feature flag `TELEGRAM_BOT_ENABLED=false`.
- `/api/telegram/admin` محمي بمفتاح `x-admin-secret`، لكنه يعتمد على header فقط بدون جلسة أو أدوار مميزة.
- الاستنتاج: نحتاج طبقة مصادقة حقيقية (جلسات + أدوار + Audit) فوق نفس قاعدة البيانات.

### قاعدة البيانات
- لا يوجد اتصال production حتى الآن (`DATABASE_URL` غير مضبوط).
- تم اختيار **PostgreSQL (Neon)** المتوافق مع Vercel، مع schema جديد `database/portal-schema.sql`.

## 2. معمارية PostgreSQL

ملفان idempotent (`CREATE TABLE IF NOT EXISTS`):

- `database/portal-schema.sql` — Phase 1:
  - `portal_admins` (email فريد، `password_hash` بصيغة `scrypt:salt:hash`، role ∈ super_admin/editor/viewer، is_active)
  - `portal_sessions` (token_hash فريد، expiry، revoked_at — إلغاء فوري للجلسات)
  - محتوى البوابة: `portal_subjects` و`portal_lectures` و`portal_announcements` و`portal_exams` و`portal_assignments` و`portal_schedule` و`portal_telegram` — كلها بمفتاح id فريد لتسهيل upsert idempotent، مع CHECK constraints للحقول المقيدة، وFK من المحاضرات إلى المواد.
  - `portal_audit` — سجل العمليات (actor, action, detail, created_at).
- `database/telegram-notifications.sql` — جداول `tg_*` لخدمة البوت (unchanged).

## 3. مصادقة Super Admin

`src/lib/server/auth.ts`:

- كلمات المرور: `scrypt` (salt عشوائي 16 بايت، مفتاح 64 بايت) مع مقارنة `timingSafeEqual`.
- الجلسات: token موقّع HMAC-SHA256 بالشكل `v1.<adminId>.<exp>.<sig>` (بمفتاح `SESSION_SECRET`)، مدة 7 أيام، ويُخزن hash الـtoken في `portal_sessions` للسماح بالإلغاء ورفض المنتهي على الخادم.
- Cookie: `portal_session` — httpOnly وsecure وsameSite=lax وpath=/.
- Rate limit لتسجيل الدخول: 5 محاولات / 10 دقائق لكل IP (in-memory يكفي لـVercel serverless).
- `requireAdmin(req)`: أولاً الـcookie ثم تحقق كامل (توقيع + expiry + revocation + is_active)، وإلا header `x-admin-secret` → super_admin فقط (للـAPI والـworker).

## 4. حماية مسارات الإدارة server-side

`src/middleware.ts` (matcher: `/admin/:path*` و`/api/admin/:path*`):

- `/admin/*` بدون cookie → redirect إلى `/admin/login?next=...`.
- `/api/admin/*` بدون cookie ولا header → 401 JSON.
- كل route تحت `/api/admin/*` يستدعي `requireAdmin` ويعيد 401/403 — حتى لو وُجد cookie غير صالح.
- الاستثناء الوحيد: `/api/admin/login` (محمي بـ rate limit).

المسارات: `login` (POST)، `logout` (POST)، `me` (GET)، `stats` (GET)، `content` (GET/POST/DELETE).

الواجهة القديمة (prototype) منقولة إلى `/admin-legacy` — متاحة للاختبار على نفس الأساسات، لكن تسجيل الدخول الجديد هو الافتراضي.

## 5. ترحيل البيانات الموثقة

- `scripts/migrate-seed-to-db.mjs` (`npm run migrate:seed`): يطبّق الـschema ثم ينقل كل بيانات `SEED` الموثقة (7 مواد، 4 محاضرات، 36 موعدًا مع الفترات الأصلية، روابط التليجرام — بدون قناة شعبة F لأنها غير مؤكدة) إلى جداول `portal_*` بـ upsert idempotent. لا يحذف أي شيء.
- `scripts/create-super-admin.mjs` (`npm run create:super-admin`): ينشئ/يحدّث حساب super_admin من `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` (12 حرفًا على الأقل). لا تُطبع كلمة المرور أبدًا.
- قراءة المحتوى (`listContent`) تقرأ من قاعدة البيانات أولاً، وتعود إلى seed إذا لم يكن `DATABASE_URL` مضبوطًا — بالتالي انتقال بدون فقدان بيانات.

## 6. لوحة الإدارة الجديدة

`/admin` (جديد) + `/admin/login`:

- عربي RTL كامل، وضع فاتح/داكن من ثيم الموقع، وتصميم من نفس نظام الـtokens.
- تبويبات: نظرة عامة (إحصاءات + سجل تدقيق)، التبليغات، المحاضرات، الامتحانات، الواجبات، الجدول، التليجرام.
- CRUD عبر `/api/admin/content` محمي بجلسة أو x-admin-secret.

## 7. ما الذي لا يزال بحاجة إلى إعداد خارجي (Vercel env vars)

1. `DATABASE_URL` — Postgres (مثل Neon): طبّق `database/portal-schema.sql` + `database/telegram-notifications.sql`.
2. `SESSION_SECRET` — ولّدها مثلًا: `openssl rand -hex 32`.
3. `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` — تُستخدمان محليًا فقط لتشغيل سكربت الـbootstrap (لا تضع كلمة المرور في Vercel؛ أنشئ الحساب محليًا ثم سجّل الدخول).
4. `ADMIN_API_SECRET` — لـ`/api/telegram/admin` وكـfallback للجلسات.
5. تفعيل البوت: `TELEGRAM_BOT_ENABLED=true` مع باقي متغيرات `TELEGRAM_*` حسب `docs/TELEGRAM_BOT_SETUP.md`.

## 8. ما لم يُنفَّذ بعد (مقصود)

- حسابات التدريسيين وممثلي الشعب **غير مفعّلة** (role `editor`/`viewer` موجود في الـschema لكن لا يوجد حساب باستثناء super_admin).
- لا تغيير على واجهة الطلاب.
- لا مساعد RAG.
- المحفزات الإشعارات التلقائية ما زالت معطّلة حتى تفعيل البوت + قاعدة البيانات.

## 9. الفحوصات

`npm test` (اختبارات merge + telegram server + auth)، `npm run typecheck`، `npm run build`، `npm run verify`، `verify:schedule`، `verify:schedule:json` — كلها يجب أن تنجح قبل النشر.

## 10. جولة مراجعة أمنية (Security review round — PR #13 update)

تم إصلاحها في نفس الفرع:

1. **`/admin-legacy`**: الآن محمي بنفس بوابة الـmiddleware (إعادة توجيه إلى `/admin/login` بدون جلسة) — لا واجهة إدارة عامة متبقية.
2. **SQL injection**: `src/lib/server/content-schema.ts` — allowlist أعمدة ثابتة لكل جدول، كل الـidentifiers بين علامتي تنصيص، كل القيم $n parameters. أعمدة غير معروفة من الطلب تُحذف. مختبر باختبارات حقن.
3. **صلاحيات**: `canModify(role)` — super_admin وeditor فقط للكتابة؛ viewer قراءة فقط. الـroute يعيد 403 للأدوار غير المخوّلة.
4. **Rate limit**: جدول `portal_login_attempts` مع upsert atomic — يعمل عبر جميع instances الـserverless؛ in-memory فقط كـfallback محلي.
5. **جلسة وCSRF وTLS**: كتابة (POST/DELETE) عبر cookie تتطلب Origin مطابقًا أو header مخصص `x-portal-admin` (لا يمكن إرساله cross-site بدون CORS)؛ cookie httpOnly+secure+sameSite=lax؛ **TLS certificate verification إجباري** (`rejectUnauthorized: true`).
6. **Audit + transactions**: كل تعديل محتوى + سجل التدقيق داخل معاملة واحدة (`withTx`).
7. **واجهة**: نماذج عربية كاملة في `/admin` (إضافة/تعديل/حذف) — لا حاجة لـAPI يدوي.
8. **اختبارات**: `content-schema.test.mjs` (حقن SQL، validation، enums) +توسيع (CSRF، RBAC، rate limit) — `npm test` الآن 28 اختبارًا.

## 11. Phase 1.1 — Corrections after second review (PR #13)

1. **TLS everywhere**: `scripts/create-super-admin.mjs` and `scripts/migrate-seed-to-db.mjs` now use `rejectUnauthorized: true`; `verify-structure.mjs` fails CI if any file disables certificate verification.
2. **Reliable audit**: `audit()` no longer swallows errors — inside `withTx()` a failed audit rolls back the content change (tested). `auditBestEffort()` is reserved for login attempts only (documented policy: login must never fail or leak because of logging).
3. **Safe seed migration**: default is now `ON CONFLICT DO NOTHING` (existing/admin-edited rows are preserved, re-runs are safe); explicit `--update` flag for controlled refreshes. Tested against pg-mem. Also fixed a real schema bug found by pg-mem: unquoted reserved column `end` in `portal_schedule` DDL.
4. **Public read-only data layer**: `/api/public/content?type=all&section=A` (no login) serves ONLY published content from PostgreSQL when `DATABASE_URL` is set (`src/lib/server/public.ts` + pure filters in `public-filters.ts`); drafts, admins, sessions, audit and subscriber tables are never queried. When the DB is not configured it falls back to the static seed (`fromDatabase:false`) and the client keeps using localStorage exactly as before (`storage.tsx` only overrides display data when `fromDatabase:true`, and never writes server data back to localStorage).
5. **E2E publishing test**: `npm run test:e2e` (`scripts/e2e-publish-test.mjs`) runs the full scenario (sign-in → create → public visibility → section targeting → edit → audit → delete → bot disabled) against a REAL database. Without `DATABASE_URL` it prints SKIP and exits 0 — it never claims success without a real connection. **Status: awaiting DATABASE_URL configuration.**
