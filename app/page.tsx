import Link from "next/link";
import { SurveyShell } from "@/components/survey/SurveyShell";

export const metadata = {
  title: "GetNudgd · Pre-Launch Survey",
  description:
    "Help us build a better referral platform. Answer 21 quick questions and get early access.",
};

export default function SurveyPage() {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        minHeight: "100vh",
      }}
    >
      <div className="survey-wrap">
        <Link href="/landing" style={{ textDecoration: "none" }}>
          <div className="survey-logo">
            <span className="logo-get">get</span>
            <span className="logo-nudgd">nudgd</span>
          </div>
        </Link>
        <SurveyShell />
      </div>
    </div>
  );
}
