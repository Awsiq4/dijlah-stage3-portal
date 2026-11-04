import {NextResponse} from "next/server";
export async function GET(){return NextResponse.json({status:"ok",service:"dijlah-stage3-transfer",mode:"frontend-prototype",databaseConnected:false,telegramConnected:false,ragConnected:false});}
