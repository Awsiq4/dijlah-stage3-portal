# تدقيق وخطة تطوير بوت «بوابة المرحلة الثالثة – جامعة دجلة» (@lasoptbot)

الإصدار المُدقَّق: فرع `vibe/phase1-secure-backend-fbb429` عند `0ac99f9` — PR #13 (draft)
نطاق هذه الوثيقة: تدقيق + خطة فقط. لا تغييرات إنتاجية، ولا credentials، ولا حذف محتوى حقيقي.

---

## A. ملخص الحالة الحالية (honest)

| المكوّن | الحالة |Evidence |
|---|---|---|
| Webhook authentication (secret إلزامي عند التفعيل) | ✅ Verified working (unit + live 401 test) | `flags.ts webhookAuthorized`, `webhook/route.ts` |
| Webhook routing: text, caption, document, commands, callbacks | ✅ Verified (document+caption handled) | `webhook/route.ts` — `message.text \|\| message.caption`, `message.document` |
| ربط حساب Telegram (token قصير، hash، single-use،RB expiry) | ✅ Verified working (live link/unlink test) | `bot.ts handleLinkStart`, `portal_link_tokens` |
| نشر PDF مباشر من البوت (getFile → Blob) | ✅ Implemented + tested via simulated webhook (ليس delivery حقيقي) | `bot.ts` document branch, `storage.ts` |
| نشر تبليغ/مادة عبر البوت مع audience + idempotency | ✅ Verified (29/29 live vs Neon + simulated webhook) | `bot.ts pub:ann/pub:lec`, `draftId` |
| لوحة تصفح للمنشورات (student menu داخل البوت) | ❌ Missing | لا توجد أزرار تصفح للطالب في `bot.ts` |
| إدارة المحتوى (تعديل/أرشفة/حذف) من البوت | ❌ Missing | `bot.ts` يدعم الإنشاء فقط |
| إشعارات تغييرات الجدول | ⚠️ Partial | `publish.ts` لا تنشر schedule events |
| Real Telegram delivery على Preview | ⚠️ Blocked (config) | يحتاج bot token + webhook set + استثناء الحماية |
| answerCallbackQuery صامت | ✅ Verified | `0ac99f9` |
| /start لمسؤول مربوط يعرض قائمة النشر | ✅ Verified | `a930f55`, `674a5e4` |

## B. قائمة المشكلات (حسب الشدة) — leads التاريخية مقابل الكود الحالي

| # | Lead | الحالة الحالية | الشدة | Evidence |
|---|---|---|---|---|
| 1 |المسؤولون مربوطون لا يرون قائمة النشر | ✅ Fixed | — | `0ac99f9`/`a930f55`: `/start` و`/menu` لمسؤول مربوط → `adminMenu()` |
| 2 | البوت يطلب روابط PDF | ✅ Fixed | — | `fe7f632`: `document` → getFile → Blob |
| 3 | document-only ignored | ✅ Fixed | — | `webhook/route.ts`: `message.text \|\| message.document \|\| caption` |
| 4 | draft identity lost (idempotency) | ✅ Fixed | — | `33595ad`: `draftId` مخزن في `portal_bot_state` |
| 5 | «✅ تم.» بعد كل زر | ✅ Fixed | — | `0ac99f9`: `answerCallbackQuery` صامت |
| 6 | Preview protection Splash webhook | ⚠️ Blocked (config) | High | يحتاج استثناء webhook من Protection أو bypass — إعدادات Vercel فقط |
| 7 | Test records invalid IDs/broken URLs | ⚠️ Data cleanup | Medium | تنظيف بيانات الاختبار في Preview DB (run_sql DELETE) |
| 8 | لا قائمة تصفح للطالب داخل البوت | ❌ Missing | High (UX) | لا أزرار تبليغات/محاضرات/جدول في `bot.ts` |
| 9 | لا تعديل/أرشفة/حذف من البوت | ❌ Missing | Medium | `bot.ts` إنشاء فقط |
| 10 | لا إشعار عند تغيير الجدول | ⚠️ Partial | Medium | `publish.ts` بدون `publishSchedule` |
| 11 | لاvolumes resume من draft بعدorney | ⚠️ Partial | Low | `portal_bot_state` تنتهي بعد 30min بدون resume UX |
| 12 |أزرار قديمة (old buttons) | ⚠️ Partial | Low | callbacks قديمة تذهب لنفس الـflow — يجب ربط draftId كل زر ارافق |

## C. مصفوفة الأدوار والصلاحيات (مstiching من `rbac.ts` — server-side فقط)

| الدور | إنشاء تبليغ | إنشاء مادة/ملزمة | Audience | تعديل/حذف |
|---|---|---|---|---|
| super_admin / editor | أي | أي مادة | الكل/شعبة | أي |
| general_representative | scope=general | أي مادة | الكل أو شعبة واحدة | ملكه فقط |
| section_representative | شعبته فقط | أي مادة | شعبتي (افتراضي) أو جميع الشعب | ملكه فقط |
| teacher | — | المواد المسندة | حسب teacher_sections | ملكه فقط |
| viewer | ❌ | ❌ | — | قراءة فقط |
| معلّق/غير مربوط | ❌ | ❌ | — | ❌ |

username في Telegram لا grants أي صلاحية أبدًا — الربط Parsing عبر `portal_telegram_links.telegram_user_id`Numerical فقط.

## D. هيكل القوائم المقترح (compact)

- **طالب**: التبليغات · المحاضرات والملازم · جدول شعبتي · الامتحانات والواجبات · إعدادات الإشعارات · مساعدة — all read-only + روابط للموقع.
- **ممثل شعبة**: نشر جديد · منشوراتي · تصفح المحتوى · حسابي (ربط/إلغاء Telegram) · مساعدة.
- **ممثل عام**: نفس  + audiences أوسع.
- **تدريسي**: نشر لمcura · منشوراتي · حسابي · مساعدة
- **super admin**: نشر جديد · إدارة المحتوى · إدارة الحسابات · حالة البوت · سجل النشاط.
-: «رجوع», «إلغاء», «القائمة الرئيسية» في كل شاشة؛ Empty states واضحة.

## E. تدفقات إدارة المحتوى (المطلوبة)

تبليغات: إنشاء → preview → نشر؛ تعديل عنوان/نص؛ pin/unpin؛ أرشفة؛ حذف مع تأكيد يعرض العنوان والجمهور؛ تعديل لا يرسل إشعارًا frivolous.
مواد: رفع PDF مباشرة (Flow B: إرسال PDF من القائمة مباشرة) → مادة بأزرار → عنوان (مقترح من اسم الملف) → جمهور → preview → نشر؛ استبدال PDF مع الحفاظ على رابط الموقع؛ أرشفة/حذف.
امتحانات/واجبات: إنشاء/تعديل/إلغاء حسب الصلاحية، تاريخ human-readable Asia/Baghdad.
جدول: عرض اليوم/الأسبوع؛ استثناءات one-off للمholidays؛ تعديلات authorized فقط.

## F. أمثلة محادثة (مختصر — التفاصيل في الخطة)

```
البوت: مرحبًا بك في بوابة المرحلة الثالثة 🌟
        [📢 التبليغات] [📚 المحاضرات والملازم]
        [🗓 جدول شعبتي] [📝 الامتحانات والواجبات]
        [⚙️ إعدادات الإشعارات] [❓ مساعدة]
```
```
ممثل A: [نشر جديد] → [📚 محاضرة/ملزمة] → [بصريات لاخطية] → (PDF) → العنوان… → [📌 شعبتي] [🌐 جميع الشعب] → معاينة → [✅ نشر الآن]
البوت: ✅ تم النشر — 🔗 عرض بالموقع: /subjects/nonlinear-optics
```

## G. التغييرات التقنية المطلوبة

- Backend: `bot.ts` (state machine + student menu + manage flows), `webhook/route.ts` (routing), `publish.ts` (+publishSchedule), `rbac.ts` (ثابتة).
- Schema: لا هجرة جديدة إلزامية؛ `portal_bot_state` يكفي؛ يمكن إضافة `archived_at` للمحتوى.
- Storage: Vercel Blob (موجود) — حد 20MB للبوت، 100MB مباشر.
- Worker: `notify.ts` drainQueue + QStash — موجود؛ إضافة dedupe (موجود عبر event_key) + delivery states (موجود).

## H. Backlog حسب مراحل

- **Phase 0**: تنظيف بيانات الاختبار (7)، إعدادات الـwebhook —.
- **Phase 1**: قائمة الطالب داخل البوت + ربط/إلغاء + نشر PDF موثوق (improve resume draft).
- **Phase 2**: تعديل/أرشفة/حذف من البوت مع تأكيدات.
- **Phase 3**: إشعارات (جدول/امتحانات/واجبات) + تفضيلات + هدوء.
- **Phase 4**: especial polish: audit في البوت، مراقبة stuck drafts، usability test.

## I. Acceptance + test matrix

Unit (67 ✓) → integration pg-mem (29/29 ✓) → API live vs Neon (✓) → deployed Preview browser (blocked: bypass) → real Telegram (blocked: bot token). Usability test مع شخص غير تقني: نشر PDF بدون فتح الموقع.

## J. نشر/rollback

Preview أولًا (بيئة الفرع)، setWebhook/getWebhookInfo، verify:live، ثم production بعد approval: deploy main + webhook بوت الإنتاج + مراقبة tg_deliveries. Rollback: promote previous deployment + القديم.

## K. إعدادات المالك (أسماء فقط)

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_ENABLED`, `TELEGRAM_SUBSCRIPTION_SECRET`, `TELEGRAM_ADMIN_API_SECRET`, `TELEGRAM_WORKER_SECRET`, `QSTASH_URL`, `QSTASH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_API_SECRET`, `PORTAL_BASE_URL` — كلها في Vercel → custom env `phase1-preview` ((Preview).

## L. دليل المالك المختصر

BOTFather → token → Vercel env → enable flag → setWebhook → /start من حساب المالك → ربط → دعوة ممثلين/تدريسيين → الطلاب يشتركون من `/notifications`.

---

## أول خمسة تغييرات (أعلى fayda)

1. قائمة الطالب داخل البوت (تصفح المحتوى بدون فتح الموقع) — High UX.
2. Flow B: إرسال PDF مباشرة من القائمة الرئيسية — High.
3. resume/unfinished draft UX عند العودة — Medium.
4. إشعارات تغييرات الجدول والامتحانات — Medium.
5. تنظيف بيانات الاختبار + Phase 0 config للـwebhook — High reliability.

## مؤجلon  (backlog)

- version history للملفات، digest يومي، quiet hours، بث القنوات، scheduled publication.

## أسئلة مفتوحة للتحقق

- Real Telegram delivery على Preview (blocked config)،limits استضافة limits (20MB bot / 4.5MB function / 100MB direct)، pg-mem quirks (ON CONFLICT RETURNING) مقابل PG الحقيقي.


---

## ✅ Implementation status update (implemented after this audit)

| Planned item | Status | Evidence |
|---|---|---|
| Role-aware home menus, /start recovery | ✅ Done | `botx.ts homeMenuFor`, live 23/23 |
| Student browsing (announcements/materials/schedule/exams/prefs) | ✅ Done | `stu:*` callbacks, live PASS |
| Back/Cancel/Main menu + silent acks | ✅ Done | `backHome`, `nav:home`, answerCallbackQuery |
| Direct PDF from main menu (Flow B) | ✅ Done | `pendingpdf` + `pdf:new`, live PASS |
| إدارة منشوراتي: list+pagination+view | ✅ Done | `adm:my`, `page:my:*`, `it:*`, live PASS |
| Edit announcement/lecture meta | ✅ Done | `editann`/`editmeta` flows, live PASS |
| Archive/restore (recoverable) | ✅ Done | `archived_at` migration + filters, live PASS |
| Delete with explicit confirmation (exact title+audience) | ✅ Done | `it:del` → `it:delok`, live PASS |
| Replace PDF keeping stable link | ✅ Done | `replaceLectureFileOwn` (same id), unit PASS |
| Draft recovery (resume/discard) | ✅ Done | `flow:resume/discard`, live PASS |
| Old buttons handled gracefully | ✅ Done | live PASS |
| Schedule-change notifications | ✅ Done | `notifyScheduleChange` |
| Real Telegram delivery | ⚠️ Blocked (owner config) | needs bot token on preview + webhook registered; owner confirmed bot already responding |
