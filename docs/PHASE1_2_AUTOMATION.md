# Phase 1.2 — أتمتة تكامل Neon + Vercel (PR #13 فقط)

تاريخ: 2026-11-04 · الفرع: `vibe/phase1-secure-backend-fbb429` · PR #13 (مسودة، لن يُدمج)

## 1. حالة الوصول في بيئة العمل الحالية

- GitHub: وصول مصرح به ✅ — تم التحقق من PR #13 (head `1763607`، CI pass، Vercel Preview success).
- **Vercel API / Neon API: لا يوجد أي مفتاح في البيئة** ❌ — لذا لا يمكنني ضبط متغيرات Vercel أو الاتصال بـ Neon مباشرة من هنا.
- أبدًا لا نطلب الـconnection string أو كلمات المرور في المحادثة؛ كل القيم تمر عبر `.env.local` (مستثنى من git) أو متغيرات البيئة.

## 2. ما تم أتمتته في المستودع

| السكربت | الوظيفة | المتطلبات |
|---|---|---|
| `npm run setup:vercel-env` (`scripts/vercel-set-env.mjs`) | يضبط `DATABASE_URL` و`SESSION_SECRET` و`ADMIN_API_SECRET` و`TELEGRAM_BOT_ENABLED=false` في Vercel عبر preview custom environment مرتبط بفرع `vibe/phase1-secure-backend-fbb429` فقط — الأسرار المولّدة عشوائيًا (32 بايت) تُحفظ في `.env.local` فقط ولا تُطبع أبدًا | `VERCEL_TOKEN` |
| `npm run bootstrap:neon` (`scripts/bootstrap-neon-phase1.sh`) | يطبّق الـschema (idempotent)، ي/bootstrap السوبر admin (إن لم توجد كلمة مرور يولّدها السكربت عشوائيًا في `.env.local` فقط)، يشغّل `migrate:seed` (INSERT-ONLY، غير destructive) | `DATABASE_URL` |
| `npm run db:schema` | تطبيق الـschema فقط | `DATABASE_URL` |
| `npm run test:e2e` | اختبار E2E حقيقي على PG: دخول السوبر → إنشاء تبليغ → حفظ → ظهور في الطبقة العامة → استهداف الشعب → تعديل → تدقيق → حذف → البوت معطّل | `DATABASE_URL` + بيانات السوبر |

## 3. الحد الأدنى اليدوي المطلوب منك (خطوات قليلة)

### أ. في Neon (لوحة التحكم فقط)
1. افتح مشروع `dijlah-stage3-portal-test` → فرع `main` → قاعدة `neondb`.
2. انسخ **connection string** (pooled) من لوحة التحكم.
3. في terminal المستودع المحلي: أنشئ `.env.local` (مستثنى من git) وضع فيه:
   ```
   DATABASE_URL=postgres://...   # القيمة من لوحة Neon — لا تضعها في GitHub أو المحادثة
   SUPER_ADMIN_EMAIL=admin@your-domain
   ```
   (كلمة مرور السوبر: إن لم تضعها، فإن السكربت يولّدها عشوائيًا في `.env.local` فقط.)

### ب. في Vercel (لوحة التحكم فقط — لأن البيئة لا تملك token)
1. Project `dijlah-stage3-portal` → Settings → Environment Variables.
2. أنشئ Custom Environment: slug `phase1-preview`، النوع Preview، **Git Branch = `vibe/phase1-secure-backend-fbb429`**.
3. أضف هذه المفاتيح إلى هذا الـcustom environment فقط (نوع Sensitive، **وليس Production**):
   - `DATABASE_URL` = connection string من Neon
   - `SESSION_SECRET` = قيمة `openssl rand -hex 32`
   - `ADMIN_API_SECRET` = `openssl rand -hex 32`
   - `TELEGRAM_BOT_ENABLED=false`
4. أعد نشر الـPreview من لوحة Vercel (Deployments → الفرع → Redeploy).

> بديل آلي: إن وفّرت `VERCEL_TOKEN` (Vercel → Settings → Tokens) لبيئة العمل، فإن `npm run setup:vercel-env` ينفّذ خطوتي 2-3 آليًا بدون طباعة أي قيمة.

### ج. محليًا (مرة واحدة)
```bash
npm run bootstrap:neon     # schema + super admin + seed (non-destructive)
npm run test:e2e           # E2E حقيقي على PG — يطبع PASS فقط مع اتصال حقيقي
```

### د. التحقق على الـPreview
- `/api/health` على الـpreview يجب أن يعرض `databaseConnected: true` و`adminAuthConfigured: true` و`telegramServiceEnabled: false` (الـpreview محمي بـSSO، لذا تحقق من داخل Vercel أو بجلسة مصرح بها).
- `/api/public/content?type=all&section=A` → `fromDatabase: true` مع 7 مواد و9 مواعيد للشعبة A و4 محاضرات.
- دخول `/admin/login` بحساب السوبر → إنشاء/تعديل/حذف تبليغ → ظهوره في `/api/public/content` — هذا سيناريو E2E عبر HTTP.

## 4. ضمانات
- الإنتاج (`main` = `8123da6`) لم يتغير؛ `/api/health` على الموقع الحي ما زال prototype بدون DB.
- Telegram معطّل: `TELEGRAM_BOT_ENABLED=false` إجباريًا؛ و`test:e2e` يرفض التشغيل إن كان مفعّلًا.
- لا حسابات تدريسيين/ممثلين — `canModify` يسمح حاليًا بـ super_admin/editor فقط ولا يوجد حساب غير السوبر.
- هجرة الـseed افتراضيًا INSERT-ONLY (`ON CONFLICT DO NOTHING`) — لا يحذف ولا يستبدل بيانات الإدارة.

## 5. ما الذي يبقى بدون وصول Vercel/Neon من هنا؟

فقط: نسخ الـconnection string من Neon، وضبط المتغيرات في Vercel (3أ-3ب)، وتشغيل `bootstrap:neon` + `test:e2e` محليًا. كل ما عدا ذلك جاهز ومختبر في PR #13.
