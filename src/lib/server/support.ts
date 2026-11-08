import {createHash, randomBytes, randomUUID} from "node:crypto";
import {q, qOne, withTx, type Queryer} from "./db.ts";
import {getLinkedAdmin} from "./bot.ts";
import {BOT_OWNER_ID} from "./flags.ts";
import {sendMessage} from "./telegram.ts";
import {checkLoginRateLimit, type AdminRow} from "./auth.ts";

export const categories: Record<string,string> = {support:"تواصل مع الدعم",idea:"اقترح فكرة",problem:"الإبلاغ عن مشكلة"};
export const statuses: Record<string,string> = {new:"جديد",awaiting:"بانتظار رد الطالب",progress:"قيد المعالجة",resolved:"تم الحل",closed:"مغلق"};
export const priorities: Record<string,string> = {normal:"عادي",important:"مهم",urgent:"عاجل"};
export const hash = (s:string) => createHash("sha256").update(s).digest("hex");
export const ticketNumber = (id:unknown) => `SUP-${String(id).padStart(6,"0")}`;
export type Actor = {identity?:string; owner:boolean; adminId?:number; telegramId?:number; permissions:string[]};
export type Attachment = {name:string; mime:string; base64:string};
export type Ticket = {id:number; identity_id:string; category:string;subject:string;section:string|null;status:string;priority:string;source:string;assigned_to:number|null;created_at:string;updated_at:string;telegram_id?:number;first_name?:string;last_name?:string;username?:string;reg_seq?:number};
export class SupportError extends Error { status:number; constructor(message:string, status=400) {super(message);this.status=status;} }
export function permission(a:Actor, key:string) {return a.owner || a.permissions.includes('support.manage') || a.permissions.includes('support.'+key);}
export async function adminActor(admin:AdminRow|null):Promise<Actor> {
 if(!admin) return {owner:false,permissions:[]};
 const linked=BOT_OWNER_ID ? await qOne(`SELECT admin_id FROM portal_telegram_links WHERE admin_id=$1 AND telegram_user_id=$2 AND revoked_at IS NULL`,[admin.id,BOT_OWNER_ID]) : null;
 const grants=await qOne<{permissions:string[]}>(`SELECT permissions FROM support_grants WHERE admin_id=$1`,[admin.id]);
 return {owner:!!linked && admin.role==='super_admin',adminId:admin.id,permissions:grants?.permissions||[]};
}
export async function telegramActor(id:number):Promise<Actor> {
 const admin=await getLinkedAdmin(id);
 const a=await adminActor(admin as AdminRow|null);
 a.owner=!!BOT_OWNER_ID && String(id)===String(BOT_OWNER_ID); a.telegramId=id;
 const existing=await qOne<{id:string}>(`SELECT id FROM support_identities WHERE telegram_id=$1`,[id]);
 if(existing) a.identity=existing.id;
 else {const row=await qOne<{id:string}>(`INSERT INTO support_identities(id,telegram_id) VALUES($1,$2) ON CONFLICT(telegram_id) DO UPDATE SET telegram_id=EXCLUDED.telegram_id RETURNING id`,[randomUUID(),id]);a.identity=row!.id;}
 return a;
}
export async function anonymousIdentity(secret:string) {
 const row=await qOne<{id:string}>(`INSERT INTO support_identities(id,secret_hash) VALUES($1,$2) ON CONFLICT(secret_hash) DO UPDATE SET secret_hash=EXCLUDED.secret_hash RETURNING id`,[randomUUID(),hash(secret)]);return row!.id;
}
export function validateAttachment(file:Attachment):Buffer {
 const b=Buffer.from(file.base64||'', 'base64');
 if(!b.length || b.length>2*1024*1024) throw new SupportError('حجم المرفق يجب أن يكون أقل من 2MB.');
 const pdf=b.subarray(0,5).toString()==='%PDF-';
 const png=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpg=b[0]===255&&b[1]===216&&b[2]===255;
 if(!((file.mime==='application/pdf'&&pdf)||(file.mime==='image/png'&&png)||(file.mime==='image/jpeg'&&jpg))) throw new SupportError('المسموح صور PNG/JPG أو PDF صالح فقط.');
 return b;
}
function text(value:unknown,min:number,max:number){const s=String(value||'').trim();if(s.length<min||s.length>max)throw new SupportError(`النص مطلوب وبحد أقصى ${max} حرف.`);return s;}
function author(a:Actor){return a.adminId&&permission(a,'reply')?'admin:'+a.adminId:a.owner?'owner':'student:'+a.identity;}
function canRead(a:Actor,t:Ticket){return a.identity===t.identity_id||permission(a,'view');}
async function ticket(db:Queryer,a:Actor,id:number,lock=false):Promise<Ticket>{
 const t=await db.qOne<Ticket>(`SELECT * FROM support_tickets WHERE id=$1${lock?' FOR UPDATE':''}`,[id]);
 if(!t||!canRead(a,t))throw new SupportError('الطلب غير موجود أو غير متاح لحسابك.',404);return t;
}
async function audit(db:Queryer,a:Actor,id:number|null,action:string,detail:unknown={}){await db.q(`INSERT INTO support_history(ticket_id,actor,action,detail) VALUES($1,$2,$3,$4)`,[id,author(a),action,JSON.stringify(detail)]);}
async function enqueue(db:Queryer,key:string,recipient:unknown,id:number,body:string){if(!recipient)return;await db.q(`INSERT INTO support_jobs(event_key,recipient,ticket_id,text) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING`,[key,recipient,id,body.slice(0,3500)]);}
async function addMessage(db:Queryer,a:Actor,id:number,body:string,key:string,internal=false,file?:Attachment){
 const bytes=file?validateAttachment(file):null;
 const m=await db.qOne<{id:number}>(`INSERT INTO support_messages(ticket_id,author,body,request_key,internal) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ticket_id,author,request_key) DO NOTHING RETURNING id`,[id,author(a),body,key,internal]);
 if(m&&file&&bytes)await db.q(`INSERT INTO support_attachments(id,message_id,name,mime,bytes) VALUES($1,$2,$3,$4,$5)`,[randomUUID(),m.id,file.name.replace(/[\r\n"/\\]/g,'_').slice(0,100),file.mime,bytes]);
 return m;
}
export async function createTicket(a:Actor,input:{category:string;subject:string;body:string;section?:string;key:string;file?:Attachment;source:'web'|'telegram'}) {
 if(!a.identity)throw new SupportError('أعد فتح صفحة الدعم.',401);
 const subject=text(input.subject,3,160),body=text(input.body,3,3000),key=text(input.key,8,100);
 if(!categories[input.category])throw new SupportError('اختر نوع الطلب.');
 if(input.file)validateAttachment(input.file);
 const section=['A','B','C','F'].includes(input.section||'')?input.section:null;
 const old=await qOne<{id:number}>(`SELECT id FROM support_tickets WHERE identity_id=$1 AND request_key=$2`,[a.identity,key]);if(old)return old;
 if(!await checkLoginRateLimit('support:create:'+a.identity,5,3600000))throw new SupportError('وصلت للحد المؤقت: 5 طلبات بالساعة. حاول لاحقًا.',429);
 return withTx(async db=>{
  const t=await db.qOne<{id:number}>(`INSERT INTO support_tickets(identity_id,category,subject,section,source,request_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id,request_key) DO NOTHING RETURNING id`,[a.identity,input.category,subject,section,input.source,key]);
  if(!t)return (await db.qOne<{id:number}>(`SELECT id FROM support_tickets WHERE identity_id=$1 AND request_key=$2`,[a.identity,key]))!;
  await addMessage(db,{...a,owner:false,adminId:undefined,permissions:[]},t.id,body,key,false,input.file);
  await audit(db,a,t.id,'created',{source:input.source});
  const profile=a.telegramId?await db.qOne<{first_name:string;last_name:string}>(`SELECT first_name,last_name FROM tg_subscribers WHERE chat_id=$1`,[a.telegramId]):null;
  await enqueue(db,'new:'+t.id,BOT_OWNER_ID,t.id,`🔔 طلب دعم جديد\n🎫 ${ticketNumber(t.id)}\n👤 ${profile?`${profile.first_name||''} ${profile.last_name||''}`:'مستخدم الموقع'}\n🏫 الشعبة: ${section||'غير محددة'}\n📂 ${categories[input.category]}\n📝 ${subject}`);
  return t;
 });
}
export async function getTicket(a:Actor,id:number) {
 const t=await ticket({q,qOne},a,id);
 const staff=permission(a,'view');
 const messages=await q(`SELECT id,author,body,internal,created_at FROM support_messages WHERE ticket_id=$1 ${staff?'':'AND internal=false'} ORDER BY id`,[id]);
 const attachments=await q(`SELECT f.id,f.message_id,f.name,f.mime FROM support_attachments f JOIN support_messages m ON m.id=f.message_id WHERE m.ticket_id=$1 ${staff?'':'AND m.internal=false'}`,[id]);
 return {ticket:t,messages,attachments,history:staff?await q(`SELECT action,detail,created_at,actor FROM support_history WHERE ticket_id=$1 ORDER BY id`,[id]):[]};
}
export async function listTickets(a:Actor,filters:Record<string,string>={}) {
 const staff=permission(a,'view'),params:unknown[]=[],conditions:string[]=[];
 const add=(sql:string,v:unknown)=>{params.push(v);conditions.push(sql.replace('?',`$${params.length}`));};
 if(!staff)add('t.identity_id=?',a.identity||'none');
 for(const k of ['category','status','section','priority'])if(filters[k])add(`t.${k}=?`,filters[k]);
 if(filters.from&&/^\d{4}-\d{2}-\d{2}$/.test(filters.from))add('t.created_at>=?::date',filters.from);
 if(filters.to&&/^\d{4}-\d{2}-\d{2}$/.test(filters.to))add("t.created_at < ?::date + interval '1 day'",filters.to);
 if(filters.q){params.push('%'+filters.q.slice(0,100)+'%');const p='$'+params.length;conditions.push(`(t.subject ILIKE ${p} OR ('SUP-'||lpad(t.id::text,6,'0')) ILIKE ${p} OR s.first_name ILIKE ${p} OR s.username ILIKE ${p} OR i.telegram_id::text ILIKE ${p})`);}
 const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
 const join='FROM support_tickets t JOIN support_identities i ON i.id=t.identity_id LEFT JOIN tg_subscribers s ON s.chat_id=i.telegram_id';
 const total=await qOne<{n:number}>(`SELECT count(*)::int AS n ${join} ${where}`,params);
 const page=Math.max(0,Math.min(10000,Number(filters.page)||0));
 const rows=await q<Ticket>(`SELECT t.*,s.first_name,s.last_name,s.username,s.reg_seq,i.telegram_id ${join} ${where} ORDER BY t.updated_at DESC,t.id DESC LIMIT 10 OFFSET $${params.length+1}`,[...params,page*10]);
 return {rows,total:total?.n||0,page};
}
export async function reply(a:Actor,id:number,body:string,key:string,internal=false,file?:Attachment){
 body=text(body,1,3000);key=text(key,8,100);
 if(internal&&!permission(a,'reply'))throw new SupportError('غير مخول.',403);
 if(!await checkLoginRateLimit('support:reply:'+author(a),30,3600000))throw new SupportError('محاولات كثيرة. حاول لاحقًا.',429);
 return withTx(async db=>{
  const t=await ticket(db,a,id,true);const staff=permission(a,'reply');
  if(!staff&&t.identity_id!==a.identity)throw new SupportError('غير مخول بالرد.',403);
  if(t.status==='closed'&&!internal)throw new SupportError('الطلب مغلق. أعد فتحه قبل الرد.');
  const m=await addMessage(db,a,id,body,key,internal,file);if(!m)return;
  if(!internal){await db.q(`UPDATE support_tickets SET updated_at=now(),status=$2,first_response_at=CASE WHEN $3 THEN COALESCE(first_response_at,now()) ELSE first_response_at END WHERE id=$1`,[id,staff?'awaiting':'progress',staff]);
   const identity=await db.qOne<{telegram_id:number}>(`SELECT telegram_id FROM support_identities WHERE id=$1`,[t.identity_id]);
   await enqueue(db,'reply:'+m.id,staff?identity?.telegram_id:BOT_OWNER_ID,id,`💬 رد جديد على ${ticketNumber(id)}\n${body}`);
  }
  await audit(db,a,id,internal?'internal_note':'reply');
 });
}
export async function changeStatus(a:Actor,id:number,status:string){
 if(!statuses[status])throw new SupportError('حالة غير صالحة.');
 await withTx(async db=>{const t=await ticket(db,a,id,true);const staff=permission(a,'close');
  if(!staff && !(t.identity_id===a.identity && (status==='closed'||(['closed','resolved'].includes(t.status)&&status==='progress'))))throw new SupportError('غير مخول لتغيير الحالة.',403);
  if(t.status===status)return;
  await db.q(`UPDATE support_tickets SET status=$2,updated_at=now(),resolved_at=CASE WHEN $2='resolved' THEN now() WHEN $2='progress' THEN NULL ELSE resolved_at END,closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END,reopened=reopened+$3 WHERE id=$1`,[id,status,['closed','resolved'].includes(t.status)&&status==='progress'?1:0]);
  await audit(db,a,id,'status',{from:t.status,to:status});
  const identity=await db.qOne<{telegram_id:number}>(`SELECT telegram_id FROM support_identities WHERE id=$1`,[t.identity_id]);
  await enqueue(db,'status:'+id+':'+randomUUID(),staff?identity?.telegram_id:BOT_OWNER_ID,id,`${ticketNumber(id)}\nحالة الطلب: ${statuses[status]}`);
 });
}
export async function attachment(a:Actor,id:string){
 const f=await qOne<{ticket_id:number;internal:boolean;name:string;mime:string;bytes:Buffer}>(`SELECT f.*,m.ticket_id,m.internal FROM support_attachments f JOIN support_messages m ON m.id=f.message_id WHERE f.id=$1`,[id]);
 if(!f)throw new SupportError('المرفق غير موجود.',404);await ticket({q,qOne},a,f.ticket_id);
 if(f.internal&&!permission(a,'view'))throw new SupportError('المرفق غير متاح.',403);return f;
}
export async function assign(a:Actor,id:number,adminId:number|null,priority:string){
 if(!permission(a,'assign'))throw new SupportError('غير مخول.',403);
 if(!priorities[priority])throw new SupportError('أولوية غير صالحة.');
 if(adminId){const staff=await qOne<{permissions:string[]}>(`SELECT g.permissions FROM support_grants g JOIN portal_admins a ON a.id=g.admin_id WHERE a.id=$1 AND a.is_active=true AND a.status='active'`,[adminId]);if(!staff?.permissions.some(p=>['support.reply','support.manage'].includes(p)))throw new SupportError('اختر موظف دعم مخولًا.');}
 await withTx(async db=>{await ticket(db,a,id,true);await db.q(`UPDATE support_tickets SET assigned_to=$2,priority=$3,updated_at=now() WHERE id=$1`,[id,adminId,priority]);await audit(db,a,id,'assigned',{adminId,priority});});
}
export async function grant(a:Actor,adminId:number,permissions:string[]){
 if(!a.owner)throw new SupportError('للمالك فقط.',403);
 const allowed=['support.view','support.reply','support.assign','support.close','support.manage'];
 if(!permissions.every(x=>allowed.includes(x)))throw new SupportError('صلاحية غير صالحة.');
 await q(`INSERT INTO support_grants(admin_id,permissions) VALUES($1,$2) ON CONFLICT(admin_id) DO UPDATE SET permissions=EXCLUDED.permissions`,[adminId,JSON.stringify(permissions)]);
 await audit({q,qOne},a,null,'permissions',{adminId,permissions});
}
export async function createLink(a:Actor){if(!a.identity)throw new SupportError('الجلسة غير متاحة.');const raw=randomBytes(24).toString('base64url');await q(`INSERT INTO support_links(token_hash,identity_id,expires_at) VALUES($1,$2,$3)`,[hash(raw),a.identity,new Date(Date.now()+15*60000).toISOString()]);return raw;}
export async function bindLink(raw:string,telegramId:number){
 await withTx(async db=>{
  const link=await db.qOne<{identity_id:string}>(`UPDATE support_links SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING identity_id`,[hash(raw)]);
  if(!link)throw new SupportError('رابط الربط منتهي أو مستخدم. اطلب رابطًا جديدًا من الموقع.');
  const target=await db.qOne<{telegram_id:number|null}>(`SELECT telegram_id FROM support_identities WHERE id=$1 FOR UPDATE`,[link.identity_id]);
  if(target?.telegram_id&&String(target.telegram_id)!==String(telegramId))throw new SupportError('الجلسة مرتبطة بحساب آخر.');
  const existing=await db.qOne<{id:string}>(`SELECT id FROM support_identities WHERE telegram_id=$1`,[telegramId]);
  if(existing&&existing.id!==link.identity_id)throw new SupportError('حسابك مرتبط بجلسة أخرى. استخدم طلباتك السابقة في البوت لهذه الجلسة.');
  await db.q(`UPDATE support_identities SET telegram_id=$2 WHERE id=$1`,[link.identity_id,telegramId]);
 });
}
export async function analytics(a:Actor){
 if(!a.owner)throw new SupportError('للمالك فقط.',403);
 const summary=await qOne(`SELECT count(*)::int AS total,count(*) FILTER(WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Baghdad') AT TIME ZONE 'Asia/Baghdad')::int AS today,count(*) FILTER(WHERE created_at>=now()-interval '7 days')::int AS days7,count(*) FILTER(WHERE created_at>=now()-interval '30 days')::int AS days30,count(*) FILTER(WHERE status NOT IN ('closed','resolved'))::int AS open,count(*) FILTER(WHERE first_response_at IS NULL)::int AS unanswered,COALESCE(sum(reopened),0)::int AS reopened,round(avg(extract(epoch from(first_response_at-created_at)))/60)::int AS first_response_minutes,round(avg(extract(epoch from(resolved_at-created_at)))/60)::int AS resolution_minutes FROM support_tickets`);
 const groups:Record<string,unknown>={};for(const field of ['section','category','priority','status','assigned_to'])groups[field]=await q(`SELECT ${field} AS label,count(*)::int AS count FROM support_tickets GROUP BY ${field}`);
 const daily=await q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD') AS day,count(*)::int AS count FROM support_tickets WHERE created_at>=now()-interval '30 days' GROUP BY day ORDER BY day`);
 const common=await q(`SELECT subject,count(*)::int AS count FROM support_tickets WHERE category='problem' GROUP BY subject ORDER BY count(*) DESC LIMIT 10`);
 return {summary,groups,daily,common};
}
// Durable bounded retry queue. Telegram has no exactly-once send API: a crash after send can duplicate a notification.
export async function drainSupport(limit=10){
 const jobs=await q<{id:number;recipient:number;ticket_id:number;text:string;attempts:number}>(`UPDATE support_jobs SET next_at=now()+interval '2 minutes',attempts=attempts+1 WHERE id IN (SELECT id FROM support_jobs WHERE sent_at IS NULL AND failed=false AND next_at<=now() AND attempts<6 ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,[limit]);
 for(const j of jobs){const res=await sendMessage(j.recipient,j.text,{replyMarkup:{inline_keyboard:[[{text:'📖 عرض الطلب',callback_data:'sup:view:'+j.ticket_id}],[{text:'💬 الرد',callback_data:'sup:reply:'+j.ticket_id}],[{text:'📋 الطلبات',callback_data:'sup:list:0'}]]}});
 if(res.ok)await q(`UPDATE support_jobs SET sent_at=now() WHERE id=$1`,[j.id]);
 else await q(`UPDATE support_jobs SET failed=$2,next_at=$3 WHERE id=$1`,[j.id,j.attempts>=6||[400,403].includes(res.error?.code||0),new Date(Date.now()+Math.max(res.retryAfter||0,Math.min(3600,30*2**j.attempts))*1000).toISOString()]);}
 return {processed:jobs.length};
}
