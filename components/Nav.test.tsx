import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "./Nav";
import { brand } from "@/src/config/brand";

describe("Nav", () => {
  it("uses the brand name for the logo alt text", () => {
    render(<Nav />);
    expect(screen.getByAltText(brand.name)).toBeInTheDocument();
  });
});
