import { brand } from "@/src/config/brand";
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
  title: `${brand.name} | ${brand.ctaGetVouched} by verified employees`,
  description: `${brand.tagline} ${brand.ctaGetVouched} by verified employees at top Indian startups. Join the waitlist.`,
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
