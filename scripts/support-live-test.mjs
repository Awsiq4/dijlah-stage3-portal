// Runs exclusively against an explicitly supplied isolated database. Never uses DATABASE_URL implicitly.
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const memory=process.argv.includes('--memory');
console.log(memory?'Using isolated in-memory PostgreSQL emulation':'Provide isolated test connection on stdin (hidden):');
let url='postgres://test';
if(!memory){const rl=createInterface({input:process.stdin});[url]=await new Promise(resolve=>rl.once('line',l=>resolve([l])));rl.close();}
process.env.DATABASE_URL=url; process.env.SESSION_SECRET='isolated-support-test';
process.env.BOT_OWNER_ID='999999999'; process.env.TELEGRAM_BOT_TOKEN='mock-test-token';
process.env.TELEGRAM_BOT_USERNAME='test_portal_bot'; process.env.TELEGRAM_BOT_ENABLED='true';
const {q,qOne}=await import('../src/lib/server/db.ts');
const S=await import('../src/lib/server/support.ts');
if(memory){
 const {newDb,DataType}=await import('pg-mem'); const mem=newDb();
 mem.public.registerFunction({name:'octet_length',args:[DataType.bytea],returns:DataType.integer,implementation:b=>b.length});
 const {Pool}=mem.adapters.createPg(); (await import('../src/lib/server/db.ts')).setPoolForTests(new Pool());
 await q(`CREATE TABLE portal_admins(id BIGSERIAL PRIMARY KEY,name TEXT,email TEXT,role TEXT,status TEXT,is_active BOOLEAN,assigned_section TEXT,assigned_subjects JSONB,perms JSONB);CREATE TABLE portal_telegram_links(id BIGSERIAL PRIMARY KEY,admin_id BIGINT,telegram_user_id BIGINT,revoked_at TIMESTAMPTZ);CREATE SEQUENCE tg_reg_seq START 10;
CREATE TABLE tg_subscribers(chat_id BIGINT PRIMARY KEY,user_id BIGINT,first_name TEXT,last_name TEXT,username TEXT,reg_seq BIGINT,section TEXT,role TEXT,status TEXT,registered_at TIMESTAMPTZ,last_activity_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,consent_at TIMESTAMPTZ);
CREATE TABLE tg_owner_notifs(event_key TEXT PRIMARY KEY,chat_id BIGINT,payload JSONB,sent_at TIMESTAMPTZ,attempts INT NOT NULL DEFAULT 0);
CREATE TABLE bot_settings(key TEXT PRIMARY KEY,value JSONB);CREATE TABLE portal_login_attempts(key TEXT PRIMARY KEY,count INTEGER,reset_at TIMESTAMPTZ);`);
}
const sql=readFileSync(new URL('../database/support.sql',import.meta.url),'utf8');
for(let i=0;i<(memory?1:2);i++)for(const part of sql.split(';').map(s=>s.trim()).filter(Boolean))await q(part);
const experienceSql=readFileSync(new URL('../database/support-experience.sql',import.meta.url),'utf8');
for(let i=0;i<(memory?1:2);i++)for(const part of experienceSql.split(';').map(s=>s.trim()).filter(Boolean))await q(part);
const siteSql=readFileSync(new URL('../database/support-site-telegram.sql',import.meta.url),'utf8');
for(let i=0;i<(memory?1:2);i++)for(const part of siteSql.split(';').map(s=>s.trim()).filter(Boolean))await q(part);
let passed=0;const ok=(v,label)=>{assert.ok(v,label);passed++;console.log('PASS '+label);};
const owner={owner:true,permissions:[]},key=randomUUID();
const identity=await S.anonymousIdentity(randomUUID());const student={owner:false,permissions:[],identity};
const outsider={owner:false,permissions:[],identity:await S.anonymousIdentity(randomUUID())};
const file={name:'safe.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nfixture\n%%EOF').toString('base64')};
const t=await S.createTicket(student,{category:'problem',subject:'TEST support '+key,body:'اختبار طلب دعم خاص',key,source:'web',file,section:'B'});
ok(t.id>0,'web ticket created');
ok((await S.createTicket(student,{category:'problem',subject:'TEST repeat',body:'duplicate',key,source:'web'})).id===t.id,'idempotent creation');
await assert.rejects(()=>S.getTicket(outsider,t.id));passed++;console.log('PASS anonymous IDOR denied');
let detail=await S.getTicket(student,t.id);ok(detail.messages.length===1,'one initial message');
const initialSeen=await qOne('SELECT last_read_id FROM support_read_states WHERE ticket_id=$1 AND reader_key=$2',
 [t.id,'student:'+identity]);
ok(Number(initialSeen?.last_read_id)>0,'opening a ticket marks it seen for the visitor');
ok(detail.attachments.length===1,'attachment saved');
await assert.rejects(()=>S.attachment(outsider,detail.attachments[0].id));passed++;
ok((await S.attachment(student,detail.attachments[0].id)).bytes.length>0,'attachment ownership');
assert.throws(()=>S.validateAttachment({...file,mime:'image/png'}));passed++;
assert.throws(()=>S.validateAttachment({...file,base64:Buffer.alloc(2097153).toString('base64')}));passed++;
await S.reply(owner,t.id,'رد من المالك',randomUUID());await S.reply(owner,t.id,'ملاحظة داخلية خاصة',randomUUID(),true);
detail=await S.getTicket(student,t.id);ok(detail.messages.length===2,'internal notes hidden from student');
ok((await S.getTicket(owner,t.id)).messages.length===3,'owner sees internal notes');
const ownDetail=await S.getTicket(owner,t.id);
ok(ownDetail.studentProfile===null,'unlinked website visitor is not falsely identified as a Telegram student');
ok(ownDetail.messages.some(m=>m.sender_type==='admin'&&!m.internal),'admin reply is server-labeled distinctly');
ok(ownDetail.messages.some(m=>m.sender_type==='internal'),'internal note is server-labeled distinctly');
ok(!('author' in ownDetail.messages[0]),'raw staff identifiers are not leaked in support messages');
ok(!('studentProfile' in await S.getTicket(student,t.id)),'student never receives staff-only Telegram metadata');

const replyKey=randomUUID();await S.reply(student,t.id,'رد الطالب',replyKey);await S.reply(student,t.id,'رد الطالب',replyKey);
ok((await S.getTicket(student,t.id)).messages.length===3,'reply deduplicated');
await S.changeStatus(owner,t.id,'resolved');await S.changeStatus(student,t.id,'progress');ok((await S.getTicket(student,t.id)).ticket.status==='progress','student reopens resolved ticket');
await S.changeStatus(student,t.id,'closed');await assert.rejects(()=>S.reply(student,t.id,'blocked',randomUUID()));passed++;
await S.changeStatus(owner,t.id,'progress');
await assert.rejects(()=>S.changeStatus(outsider,t.id,'closed'));passed++;
if(!memory) ok((await S.listTickets(owner,{q:key})).rows.some(x=>x.id===t.id),'search finds ticket');
if(!memory) ok(!(await S.listTickets(outsider,{q:key})).rows.some(x=>x.id===t.id),'search respects ownership');
if(!memory) ok((await S.listTickets(owner,{q:key,section:'A'})).rows.length===0,'section filter');
await assert.rejects(()=>S.analytics(student));passed++;
if(!memory) ok(Number((await S.analytics(owner)).summary.total)>0,'analytics from real records');

const knownIdentity = await S.anonymousIdentity(randomUUID());
await q('UPDATE support_identities SET telegram_id=$2 WHERE id=$1',[knownIdentity,88776655]);
await q(`INSERT INTO tg_subscribers(chat_id,first_name,last_name,username,reg_seq,section,role,status,registered_at)
 VALUES(88776655,'Test','Student','teststudent',7,'B','student','active',now())`);
const knownStudent={owner:false,permissions:[],identity:knownIdentity};
const knownTicket=await S.createTicket(knownStudent,{category:'idea',subject:'Known verified student',body:'Student message',key:randomUUID(),source:'web'});
const knownOwnerDetail=await S.getTicket(owner,knownTicket.id);
ok(knownOwnerDetail.studentProfile?.verified===true,'previous verified Telegram identity is discovered without new linking');
ok(knownOwnerDetail.studentProfile?.telegram_id==='88776655','correct Telegram ID shown to authorized support');
ok(knownOwnerDetail.studentProfile?.username==='teststudent','Telegram username shown only to support');
ok(knownOwnerDetail.studentProfile?.section==='B','academic section is inherited only from the verified Telegram account');
ok(!('studentProfile' in await S.getTicket(knownStudent,knownTicket.id)),'verified Telegram metadata stays private to staff');
const recoveryCode=await S.issueRecoveryCode(student);
ok(/^[a-f0-9]{64}$/.test(recoveryCode),'recovery code is cryptographically random and copyable');
const newBrowserSecret=randomUUID();
const newBrowserIdentity=await S.anonymousIdentity(newBrowserSecret);
await S.recoverBrowserIdentity(newBrowserIdentity,newBrowserSecret,recoveryCode);
ok(await S.anonymousIdentity(newBrowserSecret)===identity,'website-only recovery restores prior student tickets');
await assert.rejects(()=>S.recoverBrowserIdentity(newBrowserIdentity,newBrowserSecret,recoveryCode));passed++;
console.log('PASS recovery code cannot be reused');

await q("INSERT INTO portal_admins(id,name,email,role,status,is_active) VALUES(1,'Site Owner','owner@example.test','super_admin','active',true)");
const siteOwner=await S.adminActor({id:1,email:'owner@example.test',role:'super_admin',is_active:true});
ok(siteOwner.owner===true,'site super admin manages support without Telegram account linkage');
ok(typeof S.createLink==='undefined'&&typeof S.bindLink==='undefined'&&typeof S.telegramActor==='function',
  'legacy website account linking remains disabled; verified Telegram webhook actors supported');
await assert.rejects(()=>S.createTicket(student,{category:'idea',subject:'Unallowed bot ticket',body:'Test only',key:randomUUID(),source:'telegram'}));passed++;
console.log('PASS Telegram support submissions refused');
// Mimic PostgreSQL's strict prepared-statement parameter count for both roles.
// pg-mem does not check extra bind parameters, which hid the production bug.
const testPool=(await import('../src/lib/server/db.ts')).getPool();
const queryOriginal=testPool.query.bind(testPool);
const seenPages=[];
testPool.query=async (sql,params=[])=>{
  if (/ORDER BY t\.updated_at DESC,t\.id DESC\s+LIMIT/.test(String(sql))) {
    const placeholders=[...String(sql).matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));
    assert.equal(Math.max(...placeholders),params.length,'PostgreSQL bind argument count matches placeholders');
    assert.equal(params.at(-2),10,'page size parameter included');
    assert.equal(params.at(-1),10,'page offset bound for requested second page');
    seenPages.push(params.length);
    return {rows:[]};
  }
  if(String(sql).includes("AS pending") && String(sql).includes("AS waiting")
      && String(sql).includes("FROM support_tickets t")){
    return {rows:[{pending:1,waiting:1,done:1}]};
  }
  return queryOriginal(sql,params);
};
try {
  await S.listTickets(student,{page:'1'});
  await S.listTickets(owner,{page:'1'});
} finally {testPool.query=queryOriginal;}
ok(seenPages.length===2,'pagination uses valid prepared parameters for visitor and owner');
const jobs=await qOne('SELECT count(*)::int AS total FROM support_jobs');
ok(Number(jobs.total)===0,'legacy website ticket operations do not enqueue Telegram notifications');
// Telegram support opens ONLY after a valid website-issued deep-link token.
const sentMessages=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,opts={})=>{
 const endpoint=String(url);
 if(endpoint.startsWith("https://api.telegram.org/botmock-test-token/")){
  const payload=JSON.parse(String(opts.body||"{}"));
  const method=endpoint.split("/").at(-1);
  sentMessages.push({method,payload});
  return {ok:true,json:async()=>({ok:true,result:method==='getFile'
    ?{file_path:'photos/test.jpg',file_size:4}:{message_id:sentMessages.length}})};
 }
 if(endpoint.startsWith('https://api.telegram.org/file/botmock-test-token/'))
   return {ok:true,arrayBuffer:async()=>Uint8Array.from([255,216,255,217]).buffer};
 throw new Error("Unexpected external URL during isolated Telegram test");
};
try{
 const B=await import('../src/lib/server/botsupport.ts');
 const token='A'.repeat(27),expired='B'.repeat(27);
 await q("INSERT INTO support_site_entries(token_hash,category,expires_at) VALUES($1,'idea',now()+interval '10 minutes'),($2,'support',now()-interval '1 minute')",
   [S.hash(token),S.hash(expired)]);
 ok(!await B.receiveSupportMessage(88776655,88776655,700,{text:'without site link'}),
   'direct bot message does not create support ticket');
 await B.redeemSiteSupport(88776655,88776655,expired,{username:'teststudent',first_name:'Test',last_name:'Student'});
 const expiredState=await qOne("SELECT used_by FROM support_site_entries WHERE token_hash=$1",[S.hash(expired)]);
 ok(expiredState.used_by==null,'expired entry token is not redeemed');
 await B.redeemSiteSupport(88776655,88776655,token,{username:'teststudent',first_name:'Test',last_name:'Student'});
 const bound=await qOne("SELECT used_by FROM support_site_entries WHERE token_hash=$1",[S.hash(token)]);
 ok(Number(bound.used_by)===88776655,'valid site token is consumed atomically by Telegram sender');
 await B.redeemSiteSupport(11223344,11223344,token,{username:'attacker'});
 ok(!await B.receiveSupportMessage(11223344,11223344,701,{text:'spoofed ticket'}),
   'single-use token cannot be replayed by another Telegram account');
 ok(!await B.receiveSupportMessage(88776655,88776655,702,{text:'/support'}),
   'public /support command cannot create tickets');
 ok(await B.receiveSupportMessage(88776655,88776655,703,{text:'فكرة جديدة لتطوير البوابة'}),
   'site-authorized Telegram message creates ticket');
 const siteTicket=await qOne("SELECT t.id,t.category,t.source,i.telegram_id FROM support_tickets t JOIN support_identities i ON i.id=t.identity_id WHERE t.request_key='tg:update:703'");
 ok(siteTicket?.category==='idea'&&siteTicket?.source==='telegram'&&Number(siteTicket?.telegram_id)===88776655,
   'site category and authenticated Telegram sender are retained');
 const sender=await S.telegramActor(88776655);
 await B.clearSupportDraft(88776655); // /start cancels only the typing state.
 ok((await S.getTicket(sender,siteTicket.id)).messages.length===1,
   'plain /start does not delete an already-submitted ticket');
 await B.handleSupportCallback(999999999,999999999,'sup:o:reply:'+siteTicket.id);
 ok(await B.receiveSupportMessage(999999999,999999999,704,{text:'رد الإدارة بعد تأخير'}),
   'owner can reply later even after the student pressed /start');
 const queued=await qOne("SELECT recipient,text FROM support_jobs WHERE event_key=$1",['reply:'+siteTicket.id+':tg:update:704']);
 ok(Number(queued?.recipient)===88776655&&queued?.text.includes('رد الإدارة'),
   'delayed owner response is addressed to the correct Telegram ID');
 await B.handleSupportCallback(88990011,88990011,'sup:o:home');
 ok(sentMessages.some(m=>m.payload.chat_id===88990011&&String(m.payload.text||'').includes('خاص بالمالك')),
   'non-owner cannot open the Telegram owner support dashboard');
 const ticketCount=await qOne("SELECT count(*)::int AS n FROM support_tickets WHERE request_key='tg:update:703'");
 ok(Number(ticketCount?.n)===1,'one Telegram update creates only one ticket');
 await B.handleSupportCallback(999999999,999999999,'sup:o:status:'+siteTicket.id+':resolved');
 await B.handleSupportCallback(999999999,999999999,'sup:o:status:'+siteTicket.id+':resolved');
 const statusAlerts=await qOne('SELECT count(*)::int AS n FROM support_jobs WHERE event_key LIKE $1',
   ['status:'+siteTicket.id+':resolved:%']);
 ok(Number(statusAlerts?.n)===1,'repeated status callback does not generate a duplicate student notification');
 await B.handleSupportCallback(999999999,999999999,'sup:o:history:'+siteTicket.id+':0');
 ok(sentMessages.some(m=>m.payload.chat_id===999999999&&String(m.payload.text||'').includes('الرسائل')),
   'owner can view paginated ticket history');


 const tokenForNew='C'.repeat(27);
 await q("INSERT INTO support_site_entries(token_hash,category,expires_at) VALUES($1,'problem',now()+interval '10 minutes')",
   [S.hash(tokenForNew)]);
 await B.redeemSiteSupport(55667788,55667788,tokenForNew,{username:'new_student',first_name:'New',last_name:'User'});
 const registered=await qOne("SELECT chat_id,reg_seq FROM tg_subscribers WHERE chat_id=55667788");
 ok(Number(registered?.chat_id)===55667788&&Number(registered?.reg_seq)>0,
   'new Telegram user is registered by website support entry');
 ok(await B.receiveSupportMessage(55667788,55667788,705,{caption:'صورة توضح المشكلة',photo:[{file_id:'file_photo_1',file_size:4}]}),
   'new user can submit an optional photo with a support request');
 const photo=await qOne("SELECT a.telegram_file_id FROM support_attachments a JOIN support_messages m ON m.id=a.message_id WHERE m.request_key='tg:update:705'");
 ok(photo?.telegram_file_id==='file_photo_1','support image is stored in the existing private attachment table');

}finally{globalThis.fetch=originalFetch;}

console.log('Support integration: '+passed+' PASS; '+(memory?'pg-mem':'isolated real PostgreSQL')+'; site-gated Telegram and legacy website-data security.');
const pool=(await import('../src/lib/server/db.ts')).getPool();await pool.end();
