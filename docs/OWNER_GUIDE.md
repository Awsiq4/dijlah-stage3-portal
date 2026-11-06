# دليل المالك — Dijlah Stage 3 Portal (Phase 2/3)

PR #13 (draft) · فرع `vibe/phase1-secure-backend-fbb429` · كل الإعدادات للـPreview فقط ما لم يُذكر غير ذلك.

## 1. جدول الإعدادات (أسماء فقط — القيم تُدخل في Vercel مباشرة)

| المتغير | أين يُدخل (Vercel) | إلزامي؟ | كيف يتم الحصول عليه | كيف تتحقق بدون كشف القيمة |
|---|---|---|---|---|
| `DATABASE_URL` | Project → Settings → Environment Variables → Custom Env `phase1-preview` (branch `vibe/phase1-secure-backend-fbb429`) | نعم | Neon Console → المشروع → Connection string (pooled) | `/api/health` → `databaseConnected:true, migrationApplied:true` |
| `SESSION_SECRET` | نفس الـenv | نعم | `openssl rand -hex 32` | تسجيل دخول Admin يعمل |
| `ADMIN_API_SECRET` | نفس الـenv | نعم | `openssl rand -hex 32` | mismos header `x-admin-secret` يعمل |
| `BLOB_READ_WRITE_TOKEN` | نفس الـenv | لرفع PDF | Vercel → Storage → Blob → Create token | رفع PDF من اللوحة ينجح |
| `PORTAL_BASE_URL` | نفس الـenv | نعم | رابط الـpreview | CSRF على عمليات الكتابة يعمل |
| `PORTAL_ALLOWED_ORIGINS` | نفس الـenv | اختياري | origins إضافية | — |
| `TELEGRAM_BOT_ENABLED` | نفس الـenv | نعم | `false` أولاً ثم `true` | `/api/telegram/health` → `enabled:true` |
| `TELEGRAM_BOT_TOKEN` | نفس الـenv | للبوت | BotFather → /newbot → Token | `getMe` عبر `/api/telegram/admin` أو webhook يعمل |
| `TELEGRAM_BOT_USERNAME` | نفس الـenv | للبوت | BotFather (بدون @) | روابط t.me تظهر username الصحيح |
| `TELEGRAM_WEBHOOK_SECRET` | نفس الـenv | إلزامي عند التفعيل | `openssl rand -hex 32` | webhook يرفض 401 بدون header صحيح |
| `TELEGRAM_SUBSCRIPTION_SECRET` | نفس الـenv | للاشتراك | `openssl rand -hex 32` | زر اشترك يفتح البوت |
| `TELEGRAM_ADMIN_API_SECRET` / `TELEGRAM_WORKER_SECRET` | نفس الـenv | للإدارة والمعالجة | `openssl rand -hex 32` | `/api/telegram/admin`, `/api/telegram/worker` |
| `QSTASH_URL` / `QSTASH_TOKEN` | نفس الـenv | للطابور (اختياري) | Upstash QStash | `/api/telegram/worker` |

**Protection:** Project → Settings → Deployment Protection → "Protection Bypass for Automation" — الـsecret يُستخدم header `x-vercel-protection-bypass` للاختبارات الآلية؛ Telegram لا يرسلها → Упu either استثناء webhook أو تعطيل مؤقت للحماية على الـpreview أثناء test البوت.

## 2. إجراء إعداد بوت Preview (قابل للتكرار)
1. أنشئ بوت اختبار في BotFather (token جديد — لا تستخدم بوت الإنتاج).
2. أدخل المتغيرات أعلاه في `phase1-preview`.
3. انشر الفرع (push) → Vercel يبني Preview.
4. setWebhook: `POST https://api.telegram.org/bot<TOKEN>/setWebhook` مع `url=https://<preview>/api/telegram/webhook` و`secret_token=$TELEGRAM_WEBHOOK_SECRET` — تحقق بـ`getWebhookInfo` (title: url صحيح وpending=0 بعد أول update).
5. `/api/telegram/health` على الـpreview → `enabled:true`.

## 3. خطوات المالك 
1. **تفعيل البوت**: `TELEGRAM_BOT_ENABLED=true` في `phase1-preview`.
2. **ربط حساب المالك**: لوحة Admin → تبويب «مركز Telegram» أو «حسابي» → «ربط حساب Telegram» → افتح الرابط في محادثة البوت الخاصة → `/start` يربط الـuser id.
3. **إنشاء حسابات**: «إدارة الحسابات» → إضافة مستخدم (email + name + role + شعبة/مواد) →ينسخ رابط التفعيل (`/admin/setup?token=…`) للمستخدم → يعيّن كلمة مرور.
4. **ربط الممثلين/التدريسيين**: كلٌّ منهما يفتح `/admin` → «حسابي» → ربط Telegram.
5. **اشتراك الطلاب**: صفحة `/notifications` → زر «تفعيل الإشعارات» → /start في البوت → اختيار الشعبة → التفضيلات.

## 4. checklist نشر للإنتاج + rollback
- [ ] مراجعة PR #13 ودمجها إلى `main` بعد approval المالك
- [ ] تطبيق `database/portal-schema.sql` + `database/telegram-notifications.sql` + `database/portal-rbac.sql` على Neon الإنتاج (idempotent)
- [ ] إعداد متغيرات البيئة في Production (نفس الأسماء، قيم إنتاج منفصلة) + `TELEGRAM_BOT_ENABLED=false` مبدئيًا
- [ ] `npm run migrate:seed` Seed غير destructive
- [ ] setWebhook لبوت الإنتاج + getWebhookInfo
- [ ] اختبار E2E: `npm run verify:live` على production URL
- **Rollback**: إعادة نشر الـcommit السابق في Vercel (Deployments → … → Promote to Production)، أو `git revert` للـmerge؛ قاعدة البيانات لا تُمس (الهجرات additive فقط).

## 5. ما Meinung에서 alcalinity؟
الفرع `vibe/phase1-secure-backend-fbb429` يجب أن تبقى draft حتى review المالك.
- لا توجد واجهة إدارة AI في المشروع (أُزيلت سابقًا) — من backlog إن لزم لاحقًا.
