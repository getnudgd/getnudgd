import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer";
import { brand } from "@/src/config/brand";

describe("Footer", () => {
  it("links to the brand's social URLs", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", brand.social.linkedin);
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", brand.social.instagram);
  });
});
