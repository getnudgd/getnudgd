import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { SocialProof } from "@/components/SocialProof";
import { HowItWorks } from "@/components/HowItWorks";
import { CompanyLogos } from "@/components/CompanyLogos";
import { CtaBand } from "@/components/CtaBand";
import { Footer } from "@/components/Footer";
import { ScrollReveal } from "@/components/ScrollReveal";

export const metadata = {
  title: "GetNudgd | Get referred by verified employees",
  description:
    "Sifarish toh hoti hai. Ab fair bhi hai. Get referred by verified employees at top Indian startups. Join the waitlist.",
};

export default function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <SocialProof />
      <HowItWorks />
      <CompanyLogos />
      <CtaBand />
      <Footer />
      <ScrollReveal />
    </>
  );
}
