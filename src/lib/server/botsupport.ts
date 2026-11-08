import {randomUUID} from 'node:crypto';
import {q,qOne} from './db.ts';
import {BOT_TOKEN,PORTAL_BASE_URL} from './flags.ts';
import {sendMessage,tgFetch} from './telegram.ts';
import * as S from './support.ts';
const home={inline_keyboard:[[{text:'📩 الدعم والاقتراحات',callback_data:'sup:home'},{text:'🏠 الرئيسية',callback_data:'nav:home'}]]};
const cancel={inline_keyboard:[[{text:'🔙 رجوع',callback_data:'sup:back'},{text:'❌ إلغاء',callback_data:'sup:cancel'}],[{text:'حفظ والعودة لاحقًا',callback_data:'sup:home'}]]};
type Draft={step:string;category?:string;subject?:string;body?:string;file?:S.Attachment;key:string;ticket?:number;internal?:boolean};
async function state(chat:number){return (await qOne<{data:Draft}>(`SELECT data FROM support_drafts WHERE chat_id=$1 AND expires_at>now()`,[chat]))?.data;}
async function save(chat:number,data:Draft){await q(`INSERT INTO support_drafts(chat_id,data,expires_at) VALUES($1,$2,$3) ON CONFLICT(chat_id) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at`,[chat,JSON.stringify(data),new Date(Date.now()+86400000).toISOString()]);}
async function clear(chat:number){await q(`DELETE FROM support_drafts WHERE chat_id=$1`,[chat]);}
async function prompt(chat:number,d:Draft){
 if(d.step==='confirm'){await sendMessage(chat,`معاينة طلبك\n${S.categories[d.category||'support']}\n${d.subject}\n\n${d.body}\nالمرفق: ${d.file?.name||'بدون مرفق'}`,{replyMarkup:{inline_keyboard:[[{text:'✅ إرسال الطلب',callback_data:'sup:send:'+d.key}],...cancel.inline_keyboard]}});return;}
 const labels:Record<string,string>={subject:'اكتب عنوانًا قصيرًا للطلب (3–160 حرفًا).',body:'اكتب تفاصيل طلبك (3–3000 حرف).',attachment:'أرسل صورة PNG/JPG أو ملف PDF حتى 2MB، أو اضغط بدون مرفق.',reply:'اكتب ردك. سيُحفظ في محادثة الطلب.',note:'اكتب ملاحظة داخلية؛ لن تظهر للطالب.'};
 await sendMessage(chat,labels[d.step]||'اختر نوع طلبك.',{replyMarkup:{inline_keyboard:[...(d.step==='attachment'?[[{text:'بدون مرفق',callback_data:'sup:skip'}]]:[]),...cancel.inline_keyboard]}});
}
export async function supportCallback(chat:number,user:number,data:string){
 try{
 const a=await S.telegramActor(user);
 if(data==='sup:home'){
 const d=await state(chat);await sendMessage(chat,'📩 الدعم والاقتراحات\nتُحفظ رسائلك ومعلومات حسابك المتاحة لفريق الدعم المخوّل فقط. لا ترسل كلمات مرور أو بيانات حساسة.',{replyMarkup:{inline_keyboard:[...Object.entries(S.categories).map(([k,v])=>[{text:v,callback_data:'sup:new:'+k}]),[{text:S.permission(a,'view')?'🎫 إدارة الطلبات':'📋 طلباتي السابقة',callback_data:'sup:list:0'}],...(a.owner?[[{text:'📊 إحصائيات الدعم',callback_data:'sup:stats'}],[{text:'لوحة الدعم المتقدمة',url:PORTAL_BASE_URL+'/support'}]]:[]),...(d?[[{text:'▶️ استئناف المسودة',callback_data:'sup:resume'}]]:[]),[{text:'🏠 الرئيسية',callback_data:'nav:home'}]]}});return;
 }
 if(data==='sup:cancel'){await clear(chat);await sendMessage(chat,'تم إلغاء المسودة.',{replyMarkup:home});return;}
 if(data==='sup:stats'){const stats=await S.analytics(a);await sendMessage(chat,`📊 إحصائيات الدعم\nالإجمالي: ${stats.summary?.total}\nاليوم: ${stats.summary?.today}\nآخر 7 أيام: ${stats.summary?.days7}\nالمفتوحة: ${stats.summary?.open}\nبدون أول رد: ${stats.summary?.unanswered}\nمتوسط أول رد بالدقائق: ${stats.summary?.first_response_minutes??'لا بيانات'}\nالتفاصيل والفلاتر: ${PORTAL_BASE_URL}/support`,{replyMarkup:home});return;}
 if(data.startsWith('sup:list:')){const page=data.split(':')[2];const {rows,total}=await S.listTickets(a,{page});const kb=rows.map(t=>[{text:`${S.ticketNumber(t.id)} · ${t.subject.slice(0,32)} · ${S.statuses[t.status]}`,callback_data:'sup:view:'+t.id}]);if(Number(page)>0)kb.push([{text:'السابق',callback_data:'sup:list:'+(Number(page)-1)}]);if((Number(page)+1)*10<total)kb.push([{text:'التالي',callback_data:'sup:list:'+(Number(page)+1)}]);await sendMessage(chat,`الطلبات: ${total}`,{replyMarkup:{inline_keyboard:[...kb,...home.inline_keyboard]}});return;}
 if(data.startsWith('sup:view:')){const id=Number(data.split(':')[2]);const t=await S.getTicket(a,id);await sendMessage(chat,`${S.ticketNumber(id)} · ${S.statuses[t.ticket.status]}\n${t.ticket.subject}`,{replyMarkup:home});for(const m of t.messages.slice(-12))await sendMessage(chat,`${m.internal?'🔒 ملاحظة داخلية':String(m.author).startsWith('student:')?'👤 الطالب':'💬 الدعم'}\n${m.body}`);
 const kb=[[{text:'💬 رد',callback_data:'sup:reply:'+id}],[{text:'📎 المرفقات',callback_data:'sup:files:'+id}],[{text:['closed','resolved'].includes(t.ticket.status)?'إعادة فتح':'إغلاق الطلب',callback_data:`sup:status:${id}:${['closed','resolved'].includes(t.ticket.status)?'progress':'closed'}`}]];
 if(S.permission(a,'close'))kb.push([{text:'قيد المعالجة',callback_data:`sup:status:${id}:progress`},{text:'تم الحل',callback_data:`sup:status:${id}:resolved`}]);
 if(S.permission(a,'reply'))kb.push([{text:'🔒 ملاحظة داخلية',callback_data:'sup:note:'+id}]);
 await sendMessage(chat,'اختر الإجراء (المعروض آخر 12 رسالة؛ السجل الكامل محفوظ بالموقع):',{replyMarkup:{inline_keyboard:[...kb,...home.inline_keyboard]}});return;}
 if(data.startsWith('sup:files:')){const t=await S.getTicket(a,Number(data.split(':')[2]));if(!t.attachments.length)await sendMessage(chat,'لا توجد مرفقات.',{replyMarkup:home});else await sendMessage(chat,'اختر المرفق:',{replyMarkup:{inline_keyboard:t.attachments.map(f=>[{text:String(f.name),callback_data:'sup:file:'+f.id}])}});return;}
 if(data.startsWith('sup:file:')){const f=await S.attachment(a,data.slice(9));const form=new FormData();form.set('chat_id',String(chat));form.set('document',new Blob([new Uint8Array(f.bytes)],{type:f.mime}),f.name);const res=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,{method:'POST',body:form});if(!res.ok)throw new S.SupportError('تعذر إرسال المرفق. حاول لاحقًا.');return;}
 if(data.startsWith('sup:status:')){const [, ,id,status]=data.split(':');await S.changeStatus(a,Number(id),status);await sendMessage(chat,'تم تحديث الحالة.',{replyMarkup:home});return;}
 if(data.startsWith('sup:reply:')||data.startsWith('sup:note:')){const id=Number(data.split(':')[2]);await S.getTicket(a,id);const internal=data.startsWith('sup:note:');if(internal&&!S.permission(a,'reply'))throw new S.SupportError('غير مخول.');const d:Draft={step:internal?'note':'reply',ticket:id,key:randomUUID(),internal};await save(chat,d);await prompt(chat,d);return;}
 if(data.startsWith('sup:new:')){if(await state(chat)){await sendMessage(chat,'لديك مسودة محفوظة. استأنفها أو ألغها قبل طلب جديد.',{replyMarkup:{inline_keyboard:[[{text:'استئناف',callback_data:'sup:resume'},{text:'إلغاء المسودة',callback_data:'sup:cancel'}]]}});return;}const category=data.split(':')[2];if(!S.categories[category])return;const d:Draft={step:'subject',category,key:randomUUID()};await save(chat,d);await prompt(chat,d);return;}
 const d=await state(chat);if(!d){await sendMessage(chat,'انتهت صلاحية المسودة. ابدأ طلبًا جديدًا.',{replyMarkup:home});return;}
 if(data==='sup:resume'){await prompt(chat,d);return;}
 if(data==='sup:back'){const steps=['subject','body','attachment','confirm'];d.step=steps[Math.max(0,steps.indexOf(d.step)-1)];await save(chat,d);await prompt(chat,d);return;}
 if(data==='sup:skip'&&d.step==='attachment'){d.step='confirm';await save(chat,d);await prompt(chat,d);return;}
 if(data==='sup:send:'+d.key&&d.step==='confirm'){const profile=await qOne<{section:string}>(`SELECT section FROM tg_subscribers WHERE chat_id=$1`,[user]);const t=await S.createTicket(a,{category:d.category!,subject:d.subject!,body:d.body!,file:d.file,key:d.key,source:'telegram',section:profile?.section});await clear(chat);await sendMessage(chat,`✅ تم استلام طلبك\n🎫 ${S.ticketNumber(t.id)}\nالحالة: جديد\nراح يصلك إشعار عند وصول رد.`,{replyMarkup:home});return;}
 await sendMessage(chat,'هذا الزر غير مناسب للخطوة الحالية. افتح مسودتك مجددًا.',{replyMarkup:home});
 }catch(e){await sendMessage(chat,e instanceof S.SupportError?e.message:'تعذر إكمال العملية. حاول مجددًا، مسودتك محفوظة.',{replyMarkup:home});}
}
export async function supportMessage(chat:number,user:number,message:{text?:string;document?:{file_id:string;file_name?:string;mime_type?:string;file_size?:number};photo?:Array<{file_id:string;file_size?:number}>}):Promise<boolean>{
 const d=await state(chat);if(!d)return false;
 try{
 const body=String(message.text||'').trim();
 if(d.step==='reply'||d.step==='note'){if(!body)throw new S.SupportError('اكتب الرد نصيًا.');await S.reply(await S.telegramActor(user),d.ticket!,body,d.key,d.internal);await clear(chat);await sendMessage(chat,d.internal?'حُفظت الملاحظة الداخلية.':'حُفظ الرد وسيتم إشعار المستلم.',{replyMarkup:home});return true;}
 if(d.step==='subject'){if(body.length<3||body.length>160)throw new S.SupportError('اكتب عنوانًا من 3 إلى 160 حرفًا.');d.subject=body;d.step='body';}
 else if(d.step==='body'){if(body.length<3||body.length>3000)throw new S.SupportError('اكتب تفاصيل من 3 إلى 3000 حرف.');d.body=body;d.step='attachment';}
 else if(d.step==='attachment'){
 const doc=message.document||message.photo?.at(-1);if(!doc)throw new S.SupportError('أرسل صورة أو PDF، أو اضغط بدون مرفق.');if((doc.file_size||0)>2097152)throw new S.SupportError('أقصى حجم 2MB.');
 const f=await tgFetch<{file_path:string}>('getFile',{file_id:doc.file_id});if(!f.ok||!f.result)throw new S.SupportError('تعذر قراءة الملف.');const res=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.result.file_path}`,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw new S.SupportError('تعذر تنزيل المرفق.');
 const bytes=Buffer.from(await res.arrayBuffer());d.file={name:message.document?.file_name||'screenshot.jpg',mime:message.document?.mime_type||'image/jpeg',base64:bytes.toString('base64')};S.validateAttachment(d.file);d.step='confirm';
 }else {await prompt(chat,d);return true;}
 await save(chat,d);await prompt(chat,d);
 }catch(e){await sendMessage(chat,e instanceof S.SupportError?e.message:'تعذر إكمال الخطوة. حاول مجددًا.',{replyMarkup:cancel});}return true;
}
