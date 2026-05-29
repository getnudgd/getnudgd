import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { SocialProof } from "@/components/SocialProof";
import { HowItWorks } from "@/components/HowItWorks";
import { CompanyLogos } from "@/components/CompanyLogos";
import { CtaBand } from "@/components/CtaBand";
import { Footer } from "@/components/Footer";
import { ScrollReveal } from "@/components/ScrollReveal";

export default function Home() {
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
