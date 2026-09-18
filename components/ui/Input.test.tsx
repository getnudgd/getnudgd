import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("renders a text input with the ui-input class", () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toHaveClass("ui-input");
  });

  it("applies the error class when error is true", () => {
    render(<Input placeholder="Email" error />);
    expect(screen.getByPlaceholderText("Email")).toHaveClass("error");
  });
});
