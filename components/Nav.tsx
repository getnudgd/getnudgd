import Link from "next/link";
import Image from "next/image";
import { brand } from "@/src/config/brand";

export function Nav() {
  return (
    <header className="wl-nav">
      <div className="wl-nav-inner">
        <Link href="/" className="wl-brand">
          <Image src="/logo-light.png" alt={brand.name} height={28} width={140} style={{ objectFit: "contain" }} priority />
        </Link>
<a href="#waitlist" className="btn btn-primary btn-sm">
          Get notified
        </a>
      </div>
    </header>
  );
}
