import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";

describe("AdminLayout", () => {
  it("wraps children in the admin shell", () => {
    render(
      <AdminLayout>
        <p>Requests queue</p>
      </AdminLayout>
    );
    expect(screen.getByText("Requests queue")).toBeInTheDocument();
  });
});
