import {createHash, randomUUID} from "node:crypto";
import {q, qOne, withTx, type Queryer} from "./db.ts";
import {checkLoginRateLimit, type AdminRow} from "./auth.ts";

export const categories: Record<string,string> = {support:"تواصل مع الدعم",idea:"اقترح فكرة",problem:"الإبلاغ عن مشكلة"};
export const statuses: Record<string,string> = {new:"جديد",awaiting:"بانتظار رد الطالب",progress:"قيد المعالجة",resolved:"تم الحل",closed:"مغلق"};
export const priorities: Record<string,string> = {normal:"عادي",important:"مهم",urgent:"عاجل"};
export const hash = (s:string) => createHash("sha256").update(s).digest("hex");
export const ticketNumber = (id:unknown) => `SUP-${String(id).padStart(6,"0")}`;
export type Actor = {identity?:string; owner:boolean; adminId?:number; telegramId?:number; permissions:string[]};
export type Attachment = {name:string; mime:string; base64:string};
export type Ticket = {id:number; identity_id:string; category:string;subject:string;section:string|null;status:string;priority:string;source:string;assigned_to:number|null;created_at:string;updated_at:string;telegram_id?:number;first_name?:string;last_name?:string;username?:string;reg_seq?:number};
export type VerifiedStudentProfile = {
  telegram_id: string;
  first_name: string | null; last_name: string | null; username: string | null;
  reg_seq: number | null; section: string | null; role: string | null;
  status: string | null; registered_at: string | null;
  verified: true;
};
export type SupportMessage = {
  id: number; body: string; created_at: string; internal: boolean;
  sender_type: "student" | "admin" | "internal";
};
export class SupportError extends Error { status:number; constructor(message:string, status=400) {super(message);this.status=status;} }
export function permission(a:Actor, key:string) {return a.owner || a.permissions.includes('support.manage') || a.permissions.includes('support.'+key);}
export async function adminActor(admin:AdminRow|null):Promise<Actor> {
 if(!admin) return {owner:false,permissions:[]};
 const grants=await qOne<{permissions:string[]}>(`SELECT permissions FROM support_grants WHERE admin_id=$1`,[admin.id]);
 return {owner:admin.role==='super_admin' && admin.is_active===true,adminId:admin.id,permissions:grants?.permissions||[]};
}
export async function anonymousIdentity(secret:string) {
 const digest=hash(secret);
 const linked=await qOne<{identity_id:string}>(`SELECT identity_id FROM support_browser_links WHERE secret_hash=$1`,[digest]);
 if(linked) return linked.identity_id;
 const row=await qOne<{id:string}>(`INSERT INTO support_identities(id,secret_hash) VALUES($1,$2) ON CONFLICT(secret_hash) DO UPDATE SET secret_hash=EXCLUDED.secret_hash RETURNING id`,[randomUUID(),digest]);
 return row!.id;
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
async function addMessage(db:Queryer,a:Actor,id:number,body:string,key:string,internal=false,file?:Attachment){
 const bytes=file?validateAttachment(file):null;
 const m=await db.qOne<{id:number}>(`INSERT INTO support_messages(ticket_id,author,body,request_key,internal) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ticket_id,author,request_key) DO NOTHING RETURNING id`,[id,author(a),body,key,internal]);
 if(m&&file&&bytes)await db.q(`INSERT INTO support_attachments(id,message_id,name,mime,bytes) VALUES($1,$2,$3,$4,$5)`,[randomUUID(),m.id,file.name.replace(/[\r\n"/\\]/g,'_').slice(0,100),file.mime,bytes]);
 return m;
}
export async function createTicket(a:Actor,input:{category:string;subject:string;body:string;section?:string;key:string;file?:Attachment;source:'web'}) {
 if(!a.identity)throw new SupportError('أعد فتح صفحة الدعم.',401);
 const subject=text(input.subject,3,160),body=text(input.body,3,3000),key=text(input.key,8,100);
 if(!categories[input.category])throw new SupportError('اختر نوع الطلب.');
 if(input.source!=='web')throw new SupportError('طلبات الدعم متاحة عبر الموقع فقط.');
 if(input.file)validateAttachment(input.file);
 const section=['A','B','C','F'].includes(input.section||'')?input.section:null;
 const old=await qOne<{id:number}>(`SELECT id FROM support_tickets WHERE identity_id=$1 AND request_key=$2`,[a.identity,key]);if(old)return old;
 if(!await checkLoginRateLimit('support:create:'+a.identity,5,3600000))throw new SupportError('وصلت للحد المؤقت: 5 طلبات بالساعة. حاول لاحقًا.',429);
 return withTx(async db=>{
  const t=await db.qOne<{id:number}>(`INSERT INTO support_tickets(identity_id,category,subject,section,source,request_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id,request_key) DO NOTHING RETURNING id`,[a.identity,input.category,subject,section,input.source,key]);
  if(!t)return (await db.qOne<{id:number}>(`SELECT id FROM support_tickets WHERE identity_id=$1 AND request_key=$2`,[a.identity,key]))!;
  await addMessage(db,{...a,owner:false,adminId:undefined,permissions:[]},t.id,body,key,false,input.file);
  await audit(db,a,t.id,'created',{source:input.source});
  return t;
 });
}
export async function getTicket(a:Actor,id:number) {
 const t=await ticket({q,qOne},a,id);
 const staff=permission(a,'view');
 const raw=await q<{id:number;author:string;body:string;internal:boolean;created_at:string}>(
   `SELECT id,author,body,internal,created_at FROM support_messages
      WHERE ticket_id=$1 ${staff?'':'AND internal=false'} ORDER BY id`,[id]);
 const messages:SupportMessage[]=raw.map(m=>({
   id:m.id,body:m.body,internal:m.internal,created_at:m.created_at,
   sender_type:m.internal?'internal':m.author.startsWith('student:')?'student':'admin',
 }));
 const attachments=await q(`SELECT f.id,f.message_id,f.name,f.mime
   FROM support_attachments f JOIN support_messages m ON m.id=f.message_id
   WHERE m.ticket_id=$1 ${staff?'':'AND m.internal=false'}`,[id]);
 // Only the authenticated support staff can see an existing *verified* Telegram
 // association. We never guess an identity from a username, IP or browser alone.
 let studentProfile:VerifiedStudentProfile|null=null;
 if(staff){
   const existing=await qOne<{
     telegram_id:string|number|null;first_name:string|null;last_name:string|null;
     username:string|null;reg_seq:number|null;section:string|null;role:string|null;
     status:string|null;registered_at:string|null;
   }>(`SELECT i.telegram_id::text AS telegram_id,
       s.first_name,s.last_name,s.username,s.reg_seq,s.section,s.role,
       s.status,s.registered_at
     FROM support_identities i
     LEFT JOIN tg_subscribers s ON s.chat_id=i.telegram_id
     WHERE i.id=$1`,[t.identity_id]);
   if(existing?.telegram_id)studentProfile={
     telegram_id:String(existing.telegram_id),
     first_name:existing.first_name,last_name:existing.last_name,
     username:existing.username,reg_seq:existing.reg_seq,section:existing.section,
     role:existing.role,status:existing.status,registered_at:existing.registered_at,
     verified:true,
   };
 }
 const history=staff?await q(`SELECT action,detail,created_at,actor
   FROM support_history WHERE ticket_id=$1 ORDER BY id`,[id]):[];
 return {ticket:t,messages,attachments,history,...(staff?{studentProfile}:{})};
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
 const rows=await q<Ticket & {last_sender_type:string;section_from_telegram?:string}>(`
   SELECT t.*,
     ${staff?'s.first_name,s.last_name,s.username,s.reg_seq,i.telegram_id,s.section AS section_from_telegram,':''}
     (SELECT CASE WHEN m.author LIKE 'student:%' THEN 'student' ELSE 'admin' END
        FROM support_messages m WHERE m.ticket_id=t.id AND m.internal=false
        ORDER BY m.id DESC LIMIT 1) AS last_sender_type
   ${join} ${where}
   ORDER BY t.updated_at DESC,t.id DESC LIMIT 10 OFFSET ${params.length+1}`,[...params,page*10]);
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
export async function analytics(a:Actor){
 if(!a.owner)throw new SupportError('للمالك فقط.',403);
 const summary=await qOne(`SELECT count(*)::int AS total,count(*) FILTER(WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Baghdad') AT TIME ZONE 'Asia/Baghdad')::int AS today,count(*) FILTER(WHERE created_at>=now()-interval '7 days')::int AS days7,count(*) FILTER(WHERE created_at>=now()-interval '30 days')::int AS days30,count(*) FILTER(WHERE status NOT IN ('closed','resolved'))::int AS open,count(*) FILTER(WHERE first_response_at IS NULL)::int AS unanswered,COALESCE(sum(reopened),0)::int AS reopened,round(avg(extract(epoch from(first_response_at-created_at)))/60)::int AS first_response_minutes,round(avg(extract(epoch from(resolved_at-created_at)))/60)::int AS resolution_minutes FROM support_tickets`);
 const groups:Record<string,unknown>={};for(const field of ['section','category','priority','status','assigned_to'])groups[field]=await q(`SELECT ${field} AS label,count(*)::int AS count FROM support_tickets GROUP BY ${field}`);
 const daily=await q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD') AS day,count(*)::int AS count FROM support_tickets WHERE created_at>=now()-interval '30 days' GROUP BY day ORDER BY day`);
 const common=await q(`SELECT subject,count(*)::int AS count FROM support_tickets WHERE category='problem' GROUP BY subject ORDER BY count(*) DESC LIMIT 10`);
 return {summary,groups,daily,common};
}
