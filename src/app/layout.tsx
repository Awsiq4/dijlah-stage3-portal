import "./globals.css";
import type {Metadata, Viewport} from "next";
import {PortalProvider} from "@/lib/storage";
import AppShell from "@/components/AppShell";
export const metadata:Metadata={title:"بوابة طلبة المرحلة الثالثة | هندسة الليزر والإلكترونيات البصرية",description:"مبادرة طلابية مستقلة لمساعدة طلبة المرحلة الثالثة في متابعة المحاضرات والجدول والتبليغات."};
export const viewport:Viewport={width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="ar" dir="rtl" suppressHydrationWarning><body><PortalProvider><AppShell>{children}</AppShell></PortalProvider></body></html>;
}
