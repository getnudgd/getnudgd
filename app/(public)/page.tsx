import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { MarqueeTicker } from "@/components/MarqueeTicker";
import { SocialProof } from "@/components/SocialProof";
import { HowItWorks } from "@/components/HowItWorks";
import { CompanyLogos } from "@/components/CompanyLogos";
import { CtaBand } from "@/components/CtaBand";
import { Footer } from "@/components/Footer";
import { FadeInSection } from "@/components/FadeInSection";

export const metadata = {
  title: "GetNudgd | Get vouched in by verified employees",
  description:
    "Sifarish toh hoti hai. Ab fair bhi hai. Get vouched in by verified employees at top Indian startups. Join the waitlist.",
};

export default function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <MarqueeTicker />
      <FadeInSection>
        <SocialProof />
      </FadeInSection>
      <FadeInSection>
        <HowItWorks />
      </FadeInSection>
      <FadeInSection>
        <CompanyLogos />
      </FadeInSection>
      <FadeInSection>
        <CtaBand />
      </FadeInSection>
      <Footer />
    </>
  );
}
