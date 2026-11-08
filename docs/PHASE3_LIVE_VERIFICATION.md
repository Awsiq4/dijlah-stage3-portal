# Phase 3 — التحقق الحي على Preview (Neon + Vercel + بوت Telegram للاختبار)

## 1. تطبيق الهجرة على Neon (مرة واحدة، idempotent)
```bash
DATABASE_URL='postgres://…' node --experimental-strip-types scripts/apply-portal-rbac.mjs
# أو عبر Neon MCP: prepare_database_migration ثم مراجعة ثم complete_database_migration
```
التحقق: `GET /api/health` على الـpreview → يجب أن يعرض `migrationApplied: true` (يفحص عمود `portal_lectures.sections` + جدولي `portal_invitations` و`portal_telegram_links`).

## 2. متغيرات Vercel المطلوبة (أسماء فقط) — بيئة Preview الخاصة بالفرع فقط، لا Production
| المفتاح | الغرض |
|---|---|
| `DATABASE_URL` | اتصال Neon (pooled) |
| `SESSION_SECRET` | توقيع الجلسات |
| `ADMIN_API_SECRET` | مفتاح `x-admin-secret` |
| `BLOB_READ_WRITE_TOKEN` | رفع PDF مباشر إلى Vercel Blob |
| `PORTAL_BASE_URL` | رابط الـpreview (فحص CSRF) — في Production يُستخدم رابط الإنتاج |
| `PORTAL_ALLOWED_ORIGINS` | origins إضافية (اختياري) |
| `TELEGRAM_BOT_ENABLED` | `false` حتى authorize صريح |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | بوت الاختبار |
| `TELEGRAM_WEBHOOK_SECRET` | إلزامي عند تفعيل البوت — يُرسل في header للـwebhook |
| `TELEGRAM_SUBSCRIPTION_SECRET` | توكن الاشتراك |
| `TELEGRAM_ADMIN_API_SECRET` / `TELEGRAM_WORKER_SECRET` | مسارات الإدارة والمعالجة |
| `QSTASH_URL` / `QSTASH_TOKEN` | طابور الإشعارات |

## 3. Deployment Protection على الـPreview
إذا كانت الـpreview محمية بـSSO، فالطلبات الآلية تكون محجوبة. الحل:
- أضف `x-vercel-protection-bypass: <secret>` (من Vercel → Project → Settings → Deployment Protection) كـ`VERCEL_BYPASS` لتشغيل سكربت التحقق، أو
- عطّل الحماية مؤقتًا على الـpreview فقط.

## 4. تشغيل التحقق الحي
```bash
PREVIEW_URL=https://<preview>.vercel.app VERCEL_BYPASS=<bypass-secret> SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... node --experimental-strip-types scripts/verify-preview-live.mjs
```
يغطي: health/migration، دخول السوبر admin، دعوة ممثل شعبة A وتفعيلها، نشر PDF «جميع الشعب» و«شعبتي» عبر API اللوحة، الظهور حسب الشعبة في `/api/public/content`، رفض cross-section، تكرار النشر = سجل واحد، probe للـwebhook (401 عند secret خاطئ إذا كان البوت مفعّلًا).

## 5. Telegram end-to-end (بعد ضبط بوت الاختبار)
1. setWebhook إلى `https://<preview>.vercel.app/api/telegram/webhook` مع `X-Telegram-Bot-Api-Secret-Token` — تحقق أن Telegram يصل رغم الحماية (Protection يجب أن يسمح للـwebhook أو تستثنيه).
2. السوبر admin → «مركز Telegram» → ربط الحساب → Deep link → البوت.
3. من حساب ممثل الشعبة المرتبط: نشر PDF «جميع الشعب»، ثم PDF «شعبتي»، ثم تبليغ شعبة — تحقق من audience كل عنصر من واجهة الطالب، وأعد التأكيد → سجل واحد فقط.

## 6. حدود هذه الجلسة (شفاف)
- موصلات Neon/Vercel MCP list tools لكنها غير قابلة للاستدعاء من هذه الجلسة (لا توجد مفاتيح API في البيئة) — Migration لم تُطبَّق من هنا؛ السكربتات أعلاه جاهزة.
- الـpreview محمية بـSSO — الطلبات الآلية Blocked بدون bypass.
