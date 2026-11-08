import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {requireAdmin,checkLoginRateLimit} from '@/lib/server/auth';
import {q,qOne} from '@/lib/server/db';
import * as S from '@/lib/server/support';
export const dynamic='force-dynamic';
const COOKIE='portal_support';
async function context(req:NextRequest){
 let secret=req.cookies.get(COOKIE)?.value;const fresh=!secret||!/^[a-f0-9]{64}$/.test(secret);if(fresh)secret=randomBytes(32).toString('hex');
 const identity=await S.anonymousIdentity(secret!);const a=await S.adminActor(await requireAdmin(req));a.identity=identity;
 return {a,secret:secret!,fresh};
}
function respond(data:unknown,c?:{secret:string;fresh:boolean},status=200){const res=NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});if(c?.fresh)res.cookies.set(COOKIE,c.secret,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:180*86400});return res;}
function fail(e:unknown){return respond({error:e instanceof S.SupportError?e.message:'تعذر إكمال الطلب. حاول مجددًا.'},undefined,e instanceof S.SupportError?e.status:500);}
export async function GET(req:NextRequest){try{
 const c=await context(req),p=req.nextUrl.searchParams;
 if(p.get('file')){const f=await S.attachment(c.a,p.get('file')!);return new NextResponse(new Uint8Array(f.bytes),{headers:{'Content-Type':f.mime,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});}
 if(p.get('id'))return respond(await S.getTicket(c.a,Number(p.get('id'))),c);
 if(p.get('stats'))return respond(await S.analytics(c.a),c);
 if(p.get('staff')){if(!S.permission(c.a,'assign')&&!c.a.owner)throw new S.SupportError('غير مخول.',403);return respond(await q(`SELECT a.id,a.name,g.permissions FROM portal_admins a LEFT JOIN support_grants g ON a.id=g.admin_id WHERE a.is_active=true AND a.status='active' ORDER BY a.id`),c);}
 const data=await S.listTickets(c.a,Object.fromEntries(p));return respond({...data,owner:c.a.owner,staff:S.permission(c.a,'view'),permissions:c.a.permissions},c);
}catch(e){return fail(e);}}
export async function POST(req:NextRequest){try{
 const origin=req.headers.get('origin');if(origin!==req.nextUrl.origin||req.headers.get('x-support')!=='1')throw new S.SupportError('طلب غير مسموح.',403);
 if(Number(req.headers.get('content-length')||0)>3000000)throw new S.SupportError('حجم الطلب كبير.',413);
 const raw=await req.text();if(raw.length>3000000)throw new S.SupportError('حجم الطلب كبير.',413);
 const body=JSON.parse(raw),c=await context(req);let result:unknown={ok:true};
 if(body.action==='create'){
  // Only a daily salted hash is retained for abuse protection, not the IP address.
  const rateKey=S.hash((process.env.SESSION_SECRET||'')+new Date().toISOString().slice(0,10)+(req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')||'unknown'));
  if(!await checkLoginRateLimit('support:network:'+rateKey,20,3600000))throw new S.SupportError('محاولات كثيرة. حاول لاحقًا.',429);
  result=await S.createTicket(c.a,{...body,source:'web'});
 }else if(body.action==='reply')await S.reply(c.a,Number(body.id),body.body,body.key,body.internal===true,body.file);
 else if(body.action==='status')await S.changeStatus(c.a,Number(body.id),body.status);
 else if(body.action==='assign')await S.assign(c.a,Number(body.id),body.adminId?Number(body.adminId):null,body.priority);
 else if(body.action==='grant')await S.grant(c.a,Number(body.adminId),body.permissions||[]);
 else if(body.action==='recovery_create')result={code:await S.issueRecoveryCode(c.a)};
 else if(body.action==='recovery_use'){
   const rateKey=S.hash((process.env.SESSION_SECRET||'')+new Date().toISOString().slice(0,10)+(req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')||'unknown'));
   if(!await checkLoginRateLimit('support:recover:'+rateKey,5,3600000))throw new S.SupportError('محاولات كثيرة. حاول لاحقًا.',429);
   result=await S.recoverBrowserIdentity(c.a.identity!,c.secret,String(body.code||''));
 }

 else throw new S.SupportError('إجراء غير صالح.');
 return respond(result,c);
}catch(e){return fail(e);}}
