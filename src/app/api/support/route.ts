import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {requireAdmin} from '@/lib/server/auth';
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
// Historical website tickets remain accessible through authorized GET reads,
 // but no new support ticket or reply can be submitted outside Telegram.
export async function POST(_req:NextRequest){
 return respond({error:"تقديم طلب الدعم والردود متاح حالياً داخل بوت Telegram من خلال الموقع."},undefined,410);
}
