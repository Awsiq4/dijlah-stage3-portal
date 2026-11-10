import type {Metadata} from "next";
import Link from "next/link";
import {BookOpenText, Eye, GraduationCap, Lightbulb, Target} from "lucide-react";
import "./about.css";

export const metadata:Metadata={
  title:"حول القسم | بوابة طلبة المرحلة الثالثة",
  description:"تعرّف على قسم هندسة الليزر والإلكترونيات البصرية، ونشأته ورسالته ورؤيته وأهدافه.",
};

const aboutParagraphs=[
  "تم تأسيس قسم هندسة الليزر والإلكترونيات البصرية في العام الدراسي 2023-2024 بهدف تلبية الحاجة المتزايدة إلى تخصصات متقدمة في مجال التقنيات الضوئية الحديثة. يركز القسم على تعليم وتدريب الطلاب في مجالات الليزر، الإلكترونيات البصرية، والاتصالات الضوئية، مما يجهزهم لمواجهة تحديات السوق التقنية المتطورة.",
  "يسعى القسم إلى دمج أحدث الأبحاث العلمية والتقنية في المناهج الدراسية لتعزيز قدرات الطلاب على الابتكار والتطوير. كما يولي القسم أهمية كبيرة للتعاون مع الصناعة والمؤسسات البحثية لتطبيق المعرفة النظرية في مشاريع عملية. يوفر القسم بيئة تعليمية متقدمة تشمل مختبرات مجهزة بأحدث الأجهزة والمعدات في مجال الليزر والإلكترونيات البصرية.",
  "يلتزم القسم بتعزيز القيم الأخلاقية والمهنية لدى الطلاب، مع التركيز على المسؤولية الاجتماعية والاستدامة. كما يشجع القسم على ريادة الأعمال والابتكار التقني من خلال دعم المشاريع الطلابية والمبادرات البحثية. يضم القسم هيئة تدريسية ذات خبرة عالية ومؤهلات علمية متميزة في مجال الليزر والتقنيات الضوئية. كما يحرص القسم على بناء شبكة تعاون مع الجامعات المحلية والدولية لتبادل الخبرات والمعرفة. في المستقبل، يطمح القسم لأن يكون مركزاً متميزاً للتميز الأكاديمي والبحثي في مجال هندسة الليزر والإلكترونيات البصرية، مساهماً فعالاً في تنمية المجتمع العلمي والصناعي.",
];

const sections=[
  {
    id:"mission",
    title:"رسالة القسم",
    Icon:GraduationCap,
    paragraphs:[
      "تتمثل مهمة قسم هندسة الليزر والإلكترونيات الضوئية في تزويد الطلاب بالمعرفة والمهارات اللازمة لتصميم وتطوير حلول مبتكرة في مجال الليزر والإلكترونيات الضوئية، مع الحفاظ على الالتزام بالمسؤولية الأخلاقية والاجتماعية.",
    ],
  },
  {
    id:"vision",
    title:"الرؤية",
    Icon:Eye,
    paragraphs:[
      "تتمثل رؤيتنا في أن نصبح من الرواد والمبتكرين العالميين في مجال التقنيات القائمة على الضوء لمواجهة التحديات الاجتماعية في الحاضر والمستقبل. أن نكون إحدى كليات الهندسة الرائدة في المجالين الأكاديمي والبحثي في المنطقة للمساهمة في تطوير المجتمع المحلي والإقليمي، وتخريج خريجين مؤهلين لدخول سوق العمل أو التعليم العالي، والمساهمة في تطوير هذا المجال من خلال الأبحاث والابتكارات المتطورة.",
    ],
  },
  {
    id:"goals",
    title:"الأهداف",
    Icon:Target,
    paragraphs:[
      "يركز قسمنا على التعليم والتعاون الصناعي والابتكار والتنوع والمشاركة المجتمعية والاستدامة. نهدف إلى توفير تعليم من الدرجة الأولى في هندسة الليزر والإلكترونيات البصرية، وإعداد الطلاب للنجاح في المجالات المتطورة.",
      "نحن نعطي الأولوية للشراكة مع الصناعة والشركات الناشئة والحكومة لتطبيق الأبحاث على حلول واقعية. تشجيع ريادة الأعمال أمر أساسي لمهمتنا. نحن ملتزمون بتعزيز بيئة متنوعة وشاملة.",
      "من خلال الانخراط مع المجتمعات المحلية والعالمية، نعمل على تعزيز الوعي ومعالجة التحديات بشكل تعاوني. وأخيراً، ندمج الاستدامة في جميع جوانب عملنا من أجل مستقبل أفضل.",
    ],
  },
] as const;

export default function AboutDepartment(){
  return <article className="department-about" dir="rtl">
    <nav className="department-about-breadcrumb" aria-label="مسار الصفحة">
      <Link href="/more">المزيد</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">حول القسم</span>
    </nav>
    <header className="department-about-hero">
      <span className="department-about-hero-icon" aria-hidden="true"><Lightbulb size={28}/></span>
      <div className="department-about-hero-text">
        <span className="department-about-kicker">قسم هندسة الليزر والإلكترونيات البصرية</span>
        <h1>حول القسم</h1>
        <p>تعرّف على نشأة القسم ورسالته ورؤيته وأهدافه.</p>
      </div>
      <span className="department-about-year">تأسس عام 2023–2024</span>
    </header>
    <section className="department-about-card department-about-intro" aria-labelledby="department-about-intro-title">
      <div className="department-about-card-heading">
        <span className="department-about-card-icon" aria-hidden="true"><BookOpenText size={22}/></span>
        <h2 id="department-about-intro-title">عن القسم</h2>
      </div>
      <div className="department-about-copy">
        {aboutParagraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}
      </div>
    </section>
    <div className="department-about-grid">
      {sections.map(({id,title,Icon,paragraphs})=>
        <section key={id} className={`department-about-card department-about-${id}`} aria-labelledby={`department-about-${id}-title`}>
          <div className="department-about-card-heading">
            <span className="department-about-card-icon" aria-hidden="true"><Icon size={22}/></span>
            <h2 id={`department-about-${id}-title`}>{title}</h2>
          </div>
          <div className="department-about-copy">
            {paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}
          </div>
        </section>
      )}
    </div>
  </article>;
}
