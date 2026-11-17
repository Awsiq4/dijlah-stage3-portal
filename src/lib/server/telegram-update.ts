// Validate the Telegram trust boundary before any database or bot side effect.
export const MAX_TELEGRAM_UPDATE_BYTES = 256 * 1024;
export class TelegramUpdateBodyError extends Error {
  readonly status: 400 | 413;
  constructor(status: 400 | 413) { super("invalid Telegram update body"); this.status=status; }
}
type Actor = {id:number; username?:string; first_name?:string; last_name?:string; language_code?:string};
type File = {file_id:string; file_unique_id?:string; file_name?:string; mime_type?:string; file_size?:number};
type Message = {chat:{id:number;type:"private"};from?:Actor;message_id?:number;text?:string;caption?:string;document?:File;photo?:File[]};
export type PrivateTelegramUpdate = {update_id:number;message?:(Message & {from:Actor});callback_query?:{id:string;from:Actor;message:Message;data:string}};
const object = (value:unknown):value is Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value);
const id = (value:unknown):value is number => typeof value==="number" && Number.isSafeInteger(value) && value>0;
const text = (value:unknown,max:number):boolean => value===undefined || typeof value==="string" && value.length<=max;
function actor(value:unknown):value is Actor {
  return object(value) && id(value.id) && text(value.username,64) && text(value.first_name,256) && text(value.last_name,256);
}
function file(value:unknown):value is File {
  return object(value) && typeof value.file_id==="string" && value.file_id.length>0 && value.file_id.length<=1024 &&
    text(value.file_unique_id,1024) && text(value.file_name,4096) && text(value.mime_type,256) &&
    (value.file_size===undefined || typeof value.file_size==="number" && Number.isSafeInteger(value.file_size) && value.file_size>=0);
}
function message(value:unknown):value is Message {
  return object(value) && object(value.chat) && value.chat.type==="private" && id(value.chat.id) &&
    text(value.text,4096) && text(value.caption,4096) &&
    (value.document===undefined || file(value.document)) &&
    (value.photo===undefined || Array.isArray(value.photo) && value.photo.length<=100 && value.photo.every(file));
}
export function privateTelegramUpdate(value:unknown):PrivateTelegramUpdate|null {
  if (!object(value) || typeof value.update_id!=="number" || !Number.isSafeInteger(value.update_id) || value.update_id<0) return null;
  // Exactly one supported update kind. Private chat ID must be the authenticated
  // sender ID; never substitute the destination chat ID for a missing sender.
  if (value.message!==undefined && value.callback_query===undefined) {
    const msg=value.message;
    if (!message(msg) || !actor(msg.from) || msg.from.id!==msg.chat.id) return null;
    return value as PrivateTelegramUpdate;
  }
  if (value.callback_query!==undefined && value.message===undefined) {
    const cb=value.callback_query;
    if (!object(cb) || !actor(cb.from) || !message(cb.message) || cb.from.id!==cb.message.chat.id ||
      typeof cb.id!=="string" || !cb.id.length || cb.id.length>256 || typeof cb.data!=="string" ||
      !cb.data.length || Buffer.byteLength(cb.data,"utf8")>64) return null;
    return value as PrivateTelegramUpdate;
  }
  return null;
}
export async function readTelegramUpdateBody(req:Request):Promise<unknown> {
  const declared=req.headers.get("content-length");
  if (declared && Number(declared)>MAX_TELEGRAM_UPDATE_BYTES) throw new TelegramUpdateBodyError(413);
  if (!req.body) throw new TelegramUpdateBodyError(400);
  const reader=req.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.length;
      if (size>MAX_TELEGRAM_UPDATE_BYTES) throw new TelegramUpdateBodyError(413);
      chunks.push(value);
    }
    try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
    catch {throw new TelegramUpdateBodyError(400);}
  } finally {await reader.cancel().catch(()=>undefined);}
}
