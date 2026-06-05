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
  title: "GetNudgd | Get referred by verified employees",
  description:
    "Sifarish toh hoti hai. Ab fair bhi hai. Get referred by verified employees at top Indian startups. Join the waitlist.",
};

export default function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      {/* Animation 4 — marquee strip between hero and stats */}
      <MarqueeTicker />
      {/* Animation 2 + 3 — scroll fade + spring counter */}
      <FadeInSection>
        <SocialProof />
      </FadeInSection>
      {/* Animation 2 — each section fades in independently */}
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
