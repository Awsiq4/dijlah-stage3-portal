import type {Metadata} from "next";
import {PageHeading} from "@/components/UI";
import InstallGuide from "./InstallGuide";

export const metadata: Metadata = {
  title: "إضافة البوابة كاختصار | بوابة المرحلة الثالثة",
  description: "خطوات إضافة بوابة المرحلة الثالثة إلى الشاشة الرئيسية على هاتفك أو حاسبتك.",
  alternates: {canonical: "/install"},
};

export default function InstallPage() {
  return (
    <>
      <PageHeading title="إضافة البوابة كاختصار" description="أضف أيقونة البوابة إلى جهازك وافتحها بسرعة."/>
      <InstallGuide/>
    </>
  );
}
