# Phase 0 Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing landing page and survey into the `app/(public)` route group with `/` as the landing page, build the `components/ui/*` primitive set, stand up the role-scoped `(seeker)`/`(insider)`/`(admin)` app-shell layouts, wire `src/config/brand.ts` everywhere the brand is currently hard-coded, and sweep the codebase's locked-vocabulary violations (`referrer` → `insider`, "Get referred" → "Get vouched in", etc.).

**Architecture:** Route groups under `app/**` per AGENTS.md §1.3/§4.2. UI primitives in `components/ui/*` follow the existing codebase's pattern of plain CSS classes styled from the design tokens in `app/globals.css` (no Tailwind utility classes, no arbitrary values — AGENTS.md §4.3) rather than introducing a new styling approach. This plan runs against a separate worktree/branch from the companion backend plan and touches a disjoint set of files (`app/**`, `components/**`, `app/globals.css`); it does not depend on any backend module, since no page calls a server action or module function until Phase 1.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4 (tokens only), Vitest, @testing-library/react.

**Spec:** `AGENTS.md` at the repo root — specifically §0.4 (locked vocabulary), §1.3 (target repo layout / current state), Part 2 (shared rules), Part 4 (frontend rules: route groups, design system, component conventions, testing, definition of done), §4.9 (Phase 0 frontend backlog). No separate design doc — AGENTS.md §4.9 already fully specifies Phase 0 frontend scope (AGENTS.md §6.1: brainstorming is skipped when a spec already exists for the exact scope).

## Global Constraints

- All colors, radii, shadows, spacing, and type sizes come from the CSS custom properties already defined in `app/globals.css`. No arbitrary Tailwind values (`w-[342px]` is forbidden). (Part 4.3)
- Role-scoped accents use `var(--primary)` only; `.seeker-scope` and `.insider-scope` set it. (Part 4.3) — note the existing CSS class is currently misnamed `.referrer-scope`; Task 7 renames it, which is itself a locked-vocabulary fix.
- Fonts: Plus Jakarta Sans (display) and Inter (body) via `next/font/google` — already wired in `app/layout.tsx`; no change needed.
- Mobile-first at 390px; breakpoints `sm` 640, `md` 768, `lg` 1024.
- Card radius 16px (`--r-card`), button 10px (`--r-button`), pills 999px (`--r-pill`).
- Every list-rendering `components/ui/*` primitive that AGENTS.md §4.6 names for list states (EmptyState, ErrorState, Skeleton) is built in this phase so Phase 1 screens can use them from day one; components with no Phase 1 consumer yet (e.g. a data table) are not invented speculatively.
- Locked vocabulary (AGENTS.md §0.4) applies to all copy, identifiers, and CSS class names touched by this plan: **Insider** never "referrer"/"referral giver"/"champion"; **Seeker** never "job seeker" as an identifier; **vouch** (verb) never "refer"; **"Get vouched in"** never "Get referred".
- Brand name/domain/CTA copy comes from `src/config/brand.ts` (built in the companion backend plan's Task 2), never hard-coded (AGENTS.md §0.2).
- Small, verified commits with `type(scope): summary` messages; run `npm run lint && npm run typecheck` before each commit, and `npm test` once Vitest/Testing Library are installed in Task 1. This plan executes on branch `phase-0` (or a frontend-specific branch off it, per the controller's worktree setup).
- Do not add dependencies without a stated reason (each task below states why).

---

## Task 1: Frontend test tooling — Vitest + Testing Library

**Files:**
- Modify: `vitest.config.ts` (created by the companion backend plan's Task 1; if that task has not yet run in this worktree, create it fresh with the node-only config first, then apply this modification)
- Create: `vitest.setup.ts`

**Interfaces:**
- Produces: a jsdom test environment for `components/**` and `app/**/*.test.tsx`, with `@testing-library/jest-dom` matchers globally available — every later task's component tests depend on this.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -D @vitejs/plugin-react @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```
Reason: `@testing-library/react`/`@testing-library/jest-dom`/`@testing-library/user-event` are the decided component-testing tools (AGENTS.md §4.7); `jsdom` is the DOM environment Vitest needs to render React components in Node; `@vitejs/plugin-react` lets Vitest (which runs on Vite) transform JSX/TSX in test files.

- [ ] **Step 2: Update `vitest.config.ts`**

If the file does not exist yet (companion backend Task 1 not yet run in this worktree), create it; otherwise modify it to add the `react` plugin and a per-directory jsdom environment:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["components/**", "jsdom"],
      ["app/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 3: Create `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expect it to pass.
Run: `npm test` — expect it to run without configuration errors (0 or more tests, no failures).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts
git commit -m "chore(frontend): add Testing Library and jsdom test environment"
```

---

## Task 2: Move survey and landing into `app/(public)`, `/` becomes the landing page

**Files:**
- Create: `app/(public)/layout.tsx`
- Create: `app/(public)/page.tsx` (moved from `app/landing/page.tsx`)
- Create: `app/(public)/survey/page.tsx` (moved from `app/page.tsx`)
- Delete: `app/landing/page.tsx`
- Delete: `app/page.tsx`
- Modify: `app/layout.tsx`

**Interfaces:** none — this is a structural move with no new exported functions.

This is the current-state change AGENTS.md §1.3 calls out directly: "`app/page.tsx` is the survey and `app/landing/page.tsx` is the landing page. Both move into `app/(public)` during Phase 0 with `/` becoming the landing page."

- [ ] **Step 1: Create the `(public)` layout**

Create `app/(public)/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="seeker-scope">{children}</div>;
}
```

- [ ] **Step 2: Move the landing page to `app/(public)/page.tsx`**

Create `app/(public)/page.tsx` with the exact current content of `app/landing/page.tsx`:
```tsx
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
```
Note: `metadata.title`/`.description` already switch "Get referred" → "Get vouched in" here (AGENTS.md §0.4); Task 9 covers the rest of the vocabulary sweep.

- [ ] **Step 3: Move the survey page to `app/(public)/survey/page.tsx`**

Create `app/(public)/survey/page.tsx` with the current content of `app/page.tsx`, fixing the logo link (it pointed at `/landing`, which no longer exists now that landing is `/`):
```tsx
import Link from "next/link";
import Image from "next/image";
import { SurveyShell } from "@/components/survey/SurveyShell";

export const metadata = {
  title: "GetNudgd · Pre-Launch Survey",
  description: "Help us build GetNudgd. Answer 21 quick questions and get early access.",
};

export default function SurveyPage() {
  return (
    <div style={{ background: "var(--bg-surface)", minHeight: "100vh" }}>
      <div className="survey-wrap">
        <Link href="/" style={{ textDecoration: "none" }}>
          <div className="survey-logo">
            <Image src="/logo-light.png" alt="getnudgd" height={28} width={140} style={{ objectFit: "contain" }} priority />
          </div>
        </Link>
        <SurveyShell />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the old locations**

```bash
git rm app/landing/page.tsx app/page.tsx
rmdir app/landing 2>/dev/null || true
```

- [ ] **Step 5: Modify the root layout**

`app/(public)/layout.tsx` now owns `.seeker-scope` for public pages, and Task 7 gives `(seeker)`/`(insider)`/`(admin)` their own scope classes — so the root layout no longer needs to hard-code `seeker-scope` on `<body>`. In `app/layout.tsx`, change:
```tsx
      <body className="seeker-scope">
```
to:
```tsx
      <body>
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` and `npm run lint` — both clean.
Start the dev server and confirm both routes render: run `npm run dev` in the background, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/survey
```
Expected: both print `200`. Also confirm the old `/landing` path is gone (`curl` returns `404`). Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add -A app
git commit -m "feat(public): move landing and survey into app/(public), / is now the landing page"
```

---

## Task 3: `components/ui` primitives — Button, Badge, Chip

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Button.test.tsx`
- Create: `components/ui/Badge.tsx`
- Create: `components/ui/Badge.test.tsx`
- Create: `components/ui/Chip.tsx`
- Create: `components/ui/Chip.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `Button({variant, size, ...})`, `Badge({tone, children})`, `Chip({selected, onClick, children})` — consumed by Phase 1 screens throughout (AGENTS.md §4.6 lists these as required primitives).

- [ ] **Step 1: Write the failing Button test**

Create `components/ui/Button.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and handles click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the ghost variant class", () => {
    render(<Button variant="ghost">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("btn-ghost");
  });

  it("applies the small size class", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("btn-sm");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ui/Button.test.tsx`
Expected: FAIL — `./Button` does not exist yet.

- [ ] **Step 3: Write `components/ui/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", className, children, ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "btn-primary" : "btn-ghost";
  const sizeClass = size === "sm" ? "btn-sm" : "";
  const classes = ["btn", variantClass, sizeClass, className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
```
This reuses the `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-sm` classes already defined in `app/globals.css` — no new CSS needed for Button.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/ui/Button.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing Badge test**

Create `components/ui/Badge.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children with a neutral tone by default", () => {
    render(<Badge>Pending</Badge>);
    expect(screen.getByText("Pending")).toHaveClass("ui-badge-neutral");
  });

  it("applies the requested tone class", () => {
    render(<Badge tone="success">Verified</Badge>);
    expect(screen.getByText("Verified")).toHaveClass("ui-badge-success");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run components/ui/Badge.test.tsx`
Expected: FAIL — `./Badge` does not exist yet.

- [ ] **Step 7: Write `components/ui/Badge.tsx` and its CSS**

```tsx
import type { ReactNode } from "react";

export interface BadgeProps {
  tone?: "neutral" | "success" | "error" | "primary";
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}
```

Append to `app/globals.css` (in the "COMPONENT PRIMITIVES" section):
```css
.ui-badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: var(--r-pill);
  font-size: var(--fs-label); font-weight: 600;
  letter-spacing: var(--tracking-label); text-transform: uppercase;
}
.ui-badge-neutral { background: var(--ink-100); color: var(--ink-700); }
.ui-badge-success { background: var(--success-bg); color: var(--success); }
.ui-badge-error   { background: #FEE2E2; color: var(--error); }
.ui-badge-primary { background: var(--primary-soft); color: var(--primary); }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run components/ui/Badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing Chip test**

Create `components/ui/Chip.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders unselected by default and toggles on click", () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Remote</Chip>);
    const chip = screen.getByRole("button", { name: "Remote" });
    expect(chip).not.toHaveClass("selected");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the selected class when selected", () => {
    render(<Chip selected>Remote</Chip>);
    expect(screen.getByRole("button", { name: "Remote" })).toHaveClass("selected");
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run components/ui/Chip.test.tsx`
Expected: FAIL — `./Chip` does not exist yet.

- [ ] **Step 11: Write `components/ui/Chip.tsx`**

```tsx
import type { ReactNode } from "react";

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, children }: ChipProps) {
  return (
    <button type="button" className={`chip${selected ? " selected" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
```
Reuses the existing `.chip`/`.chip.selected` classes from `app/globals.css` (already token-based and generic) — no new CSS needed.

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run components/ui/Chip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 13: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
```bash
git add components/ui app/globals.css
git commit -m "feat(ui): add Button, Badge, and Chip primitives"
```

---

## Task 4: `components/ui` primitives — Card, Input, Select

**Files:**
- Create: `components/ui/Card.tsx`
- Create: `components/ui/Card.test.tsx`
- Create: `components/ui/Input.tsx`
- Create: `components/ui/Input.test.tsx`
- Create: `components/ui/Select.tsx`
- Create: `components/ui/Select.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `Card({children, className})`, `Input(props)`, `Select({options, ...})`.

- [ ] **Step 1: Write the failing Card test**

Create `components/ui/Card.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children inside a ui-card container", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toHaveClass("ui-card");
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then write `components/ui/Card.tsx`**

Run: `npx vitest run components/ui/Card.test.tsx` — expect FAIL.

```tsx
import type { ReactNode } from "react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["ui-card", className].filter(Boolean).join(" ")}>{children}</div>;
}
```

Append to `app/globals.css`:
```css
.ui-card {
  background: var(--bg-card);
  border: 0.5px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  padding: 20px;
}
```

Run: `npx vitest run components/ui/Card.test.tsx` — expect PASS (1 test).

- [ ] **Step 3: Write the failing Input test**

Create `components/ui/Input.test.tsx`:
```tsx
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
```

- [ ] **Step 4: Run test to verify it fails, then write `components/ui/Input.tsx`**

Run: `npx vitest run components/ui/Input.test.tsx` — expect FAIL.

```tsx
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error = false, className, ...rest }: InputProps) {
  const classes = ["ui-input", error ? "error" : "", className].filter(Boolean).join(" ");
  return <input className={classes} {...rest} />;
}
```

Append to `app/globals.css`:
```css
.ui-input {
  width: 100%;
  padding: 13px 14px;
  background: #fff;
  border: 0.5px solid var(--border);
  border-radius: var(--r-button);
  font-family: var(--font-body); font-size: 14px;
  color: var(--ink-900);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ui-input::placeholder { color: var(--fg-muted); }
.ui-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent); }
.ui-input.error { border-color: var(--error); box-shadow: 0 0 0 3px rgba(239,68,68,0.15); }
```

Run: `npx vitest run components/ui/Input.test.tsx` — expect PASS (2 tests).

- [ ] **Step 5: Write the failing Select test**

Create `components/ui/Select.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./Select";

describe("Select", () => {
  it("renders an option per entry in options", () => {
    render(<Select options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} aria-label="Choose" />);
    const select = screen.getByLabelText("Choose");
    expect(select).toHaveClass("ui-input");
    expect(screen.getByRole("option", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Option B" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails, then write `components/ui/Select.tsx`**

Run: `npx vitest run components/ui/Select.test.tsx` — expect FAIL.

```tsx
import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <select className={["ui-input", className].filter(Boolean).join(" ")} {...rest}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
```

Run: `npx vitest run components/ui/Select.test.tsx` — expect PASS (1 test).

- [ ] **Step 7: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
```bash
git add components/ui app/globals.css
git commit -m "feat(ui): add Card, Input, and Select primitives"
```

---

## Task 5: `components/ui` primitives — Sheet/Modal, Skeleton, EmptyState, ErrorState

**Files:**
- Create: `components/ui/Sheet.tsx`
- Create: `components/ui/Sheet.test.tsx`
- Create: `components/ui/Skeleton.tsx`
- Create: `components/ui/Skeleton.test.tsx`
- Create: `components/ui/EmptyState.tsx`
- Create: `components/ui/EmptyState.test.tsx`
- Create: `components/ui/ErrorState.tsx`
- Create: `components/ui/ErrorState.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `Sheet({open, onClose, title, children})`, `Skeleton({width?, height?})`, `EmptyState({title, description, action?})`, `ErrorState({title, onRetry?})` — the four required states from AGENTS.md §4.6 ("Every list screen implements all four states: loading (skeleton), empty..., error..., populated") plus the Sheet used for the send-request flow (§4.5).

- [ ] **Step 1: Write the failing Sheet test**

Create `components/ui/Sheet.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Send request">
        Body
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as a dialog with the title and children when open", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Send request">
        Body content
      </Sheet>
    );
    expect(screen.getByRole("dialog", { name: "Send request" })).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Send request">
        Body
      </Sheet>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Send request">
        Body
      </Sheet>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/ui/Sheet.test.tsx`
Expected: FAIL — `./Sheet` does not exist yet.

- [ ] **Step 3: Write `components/ui/Sheet.tsx` and its CSS**

```tsx
"use client";
import { useEffect, type ReactNode } from "react";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-sheet-overlay" role="presentation" onClick={onClose}>
      <div className="ui-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ui-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="ui-sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>
  );
}
```

Append to `app/globals.css`:
```css
.ui-sheet-overlay {
  position: fixed; inset: 0; background: rgba(17,24,39,0.4);
  display: flex; align-items: flex-end; justify-content: center;
  z-index: 100;
}
@media (min-width: 640px) {
  .ui-sheet-overlay { align-items: center; }
}
.ui-sheet {
  background: var(--bg-card);
  border-radius: var(--r-card) var(--r-card) 0 0;
  width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto;
  padding: 20px;
  box-shadow: var(--shadow-pop);
}
@media (min-width: 640px) {
  .ui-sheet { border-radius: var(--r-card); }
}
.ui-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.ui-sheet-close { background: transparent; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: var(--fg-muted); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ui/Sheet.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing Skeleton, EmptyState, ErrorState tests**

Create `components/ui/Skeleton.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a hidden placeholder block with the requested size", () => {
    const { container } = render(<Skeleton width="80px" height="20px" />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveStyle({ width: "80px", height: "20px" });
  });
});
```

Create `components/ui/EmptyState.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders a title, description, and optional action", () => {
    render(<EmptyState title="No requests yet" description="Send your first Insider Request." action={<button>Browse Insiders</button>} />);
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.getByText("Send your first Insider Request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse Insiders" })).toBeInTheDocument();
  });
});
```

Create `components/ui/ErrorState.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("renders the title as an alert", () => {
    render(<ErrorState title="Couldn't load requests" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load requests");
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load requests" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry button when onRetry is not provided", () => {
    render(<ErrorState title="Couldn't load requests" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run components/ui/Skeleton.test.tsx components/ui/EmptyState.test.tsx components/ui/ErrorState.test.tsx`
Expected: FAIL — none of the three components exist yet.

- [ ] **Step 7: Write the three components and their CSS**

`components/ui/Skeleton.tsx`:
```tsx
export function Skeleton({ width = "100%", height = "16px" }: { width?: string; height?: string }) {
  return <div className="ui-skeleton" style={{ width, height }} aria-hidden="true" />;
}
```

`components/ui/EmptyState.tsx`:
```tsx
import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ui-empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
```

`components/ui/ErrorState.tsx`:
```tsx
export function ErrorState({ title, onRetry }: { title: string; onRetry?: () => void }) {
  return (
    <div className="ui-error-state" role="alert">
      <h3>{title}</h3>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
```

Append to `app/globals.css`:
```css
.ui-skeleton {
  background: linear-gradient(90deg, var(--ink-100) 25%, var(--ink-200) 37%, var(--ink-100) 63%);
  background-size: 400% 100%;
  border-radius: var(--r-card-sm);
  animation: ui-skeleton-pulse 1.4s ease infinite;
}
@keyframes ui-skeleton-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-skeleton { animation: none; }
}

.ui-empty-state, .ui-error-state {
  text-align: center; padding: 40px 20px;
  color: var(--fg-2);
}
.ui-empty-state h3, .ui-error-state h3 { font-size: var(--fs-h3); margin-bottom: 8px; }
.ui-error-state, .ui-error-state h3 { color: var(--error); }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run components/ui/Skeleton.test.tsx components/ui/EmptyState.test.tsx components/ui/ErrorState.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 9: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
```bash
git add components/ui app/globals.css
git commit -m "feat(ui): add Sheet, Skeleton, EmptyState, and ErrorState primitives"
```

---

## Task 6: `components/ui` primitives — Stepper, Countdown, Timeline

**Files:**
- Create: `components/ui/Stepper.tsx`
- Create: `components/ui/Stepper.test.tsx`
- Create: `components/ui/Countdown.tsx`
- Create: `components/ui/Countdown.test.tsx`
- Create: `components/ui/Timeline.tsx`
- Create: `components/ui/Timeline.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `Stepper({value, min?, max?, step?, onChange})`, `Countdown({deadline, serverNow})`, `Timeline({steps})` — consumed by Phase 1's rewards redemption stepper, the insider 48h/re-verify countdowns, and the request timeline screens (AGENTS.md §4.5).

- [ ] **Step 1: Write the failing Stepper test**

Create `components/ui/Stepper.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("calls onChange with an incremented value", () => {
    const onChange = vi.fn();
    render(<Stepper value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("calls onChange with a decremented value", () => {
    const onChange = vi.fn();
    render(<Stepper value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("disables decrease at min and increase at max", () => {
    const onChange = vi.fn();
    render(<Stepper value={5} min={0} max={5} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease" })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then write `components/ui/Stepper.tsx`**

Run: `npx vitest run components/ui/Stepper.test.tsx` — expect FAIL.

```tsx
export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Stepper({ value, min = 0, max = Infinity, step = 1, onChange }: StepperProps) {
  return (
    <div className="ui-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label="Decrease">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label="Increase">
        +
      </button>
    </div>
  );
}
```

Append to `app/globals.css`:
```css
.ui-stepper {
  display: inline-flex; align-items: center; gap: 12px;
  border: 0.5px solid var(--border); border-radius: var(--r-pill);
  padding: 6px 8px;
}
.ui-stepper button {
  width: 28px; height: 28px; border-radius: 50%; border: 0;
  background: var(--primary-soft); color: var(--primary);
  font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ui-stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
.ui-stepper span { min-width: 24px; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
```

Run: `npx vitest run components/ui/Stepper.test.tsx` — expect PASS (3 tests).

- [ ] **Step 3: Write the failing Countdown test**

Create `components/ui/Countdown.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  it("renders hours and minutes remaining until the deadline", () => {
    const serverNow = new Date("2026-01-01T00:00:00Z");
    const deadline = new Date("2026-01-01T02:30:00Z");
    render(<Countdown deadline={deadline} serverNow={serverNow} />);
    expect(screen.getByText("2h 30m")).toBeInTheDocument();
  });

  it("renders Expired once the deadline has passed", () => {
    const serverNow = new Date("2026-01-02T00:00:00Z");
    const deadline = new Date("2026-01-01T00:00:00Z");
    render(<Countdown deadline={deadline} serverNow={serverNow} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then write `components/ui/Countdown.tsx`**

Run: `npx vitest run components/ui/Countdown.test.tsx` — expect FAIL.

```tsx
"use client";
import { useEffect, useState } from "react";

export interface CountdownProps {
  deadline: Date;
  serverNow: Date;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function Countdown({ deadline, serverNow }: CountdownProps) {
  const [clientOffsetMs] = useState(() => serverNow.getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + clientOffsetMs);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + clientOffsetMs), 30_000);
    return () => clearInterval(id);
  }, [clientOffsetMs]);

  const remaining = deadline.getTime() - now;
  return <span className="ui-countdown">{formatRemaining(remaining)}</span>;
}
```
Renders from `serverNow` (the server's clock at render time), not the client's local clock, per AGENTS.md §4.6 ("Countdowns render server time offset, not client clock, to avoid drift").

Run: `npx vitest run components/ui/Countdown.test.tsx` — expect PASS (2 tests).

- [ ] **Step 5: Write the failing Timeline test**

Create `components/ui/Timeline.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  it("renders one item per step and marks completed steps", () => {
    render(
      <Timeline
        steps={[
          { label: "Sent", complete: true, at: new Date("2026-01-01T00:00:00Z") },
          { label: "Accepted", complete: false },
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass("complete");
    expect(items[1]).not.toHaveClass("complete");
  });
});
```

- [ ] **Step 6: Run test to verify it fails, then write `components/ui/Timeline.tsx`**

Run: `npx vitest run components/ui/Timeline.test.tsx` — expect FAIL.

```tsx
export interface TimelineStep {
  label: string;
  at?: Date;
  complete: boolean;
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="ui-timeline">
      {steps.map((step) => (
        <li key={step.label} className={step.complete ? "ui-timeline-step complete" : "ui-timeline-step"}>
          <span className="ui-timeline-dot" aria-hidden="true" />
          <span className="ui-timeline-label">{step.label}</span>
          {step.at && <time className="ui-timeline-time">{step.at.toLocaleString("en-IN")}</time>}
        </li>
      ))}
    </ol>
  );
}
```

Append to `app/globals.css`:
```css
.ui-timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 16px; }
.ui-timeline-step { display: flex; align-items: baseline; gap: 10px; color: var(--fg-muted); }
.ui-timeline-step.complete { color: var(--ink-900); }
.ui-timeline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-300); flex-shrink: 0; }
.ui-timeline-step.complete .ui-timeline-dot { background: var(--primary); }
.ui-timeline-label { font-weight: 600; font-size: var(--fs-small); flex: 1; }
.ui-timeline-time { font-size: var(--fs-label); color: var(--fg-muted); }
```

Run: `npx vitest run components/ui/Timeline.test.tsx` — expect PASS (1 test).

- [ ] **Step 7: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
```bash
git add components/ui app/globals.css
git commit -m "feat(ui): add Stepper, Countdown, and Timeline primitives"
```

---

## Task 7: Role-scoped app shell layouts, `.insider-scope` rename

**Files:**
- Modify: `app/globals.css`
- Create: `app/(seeker)/layout.tsx`
- Create: `app/(seeker)/layout.test.tsx`
- Create: `app/(insider)/layout.tsx`
- Create: `app/(insider)/layout.test.tsx`
- Create: `app/(admin)/admin/layout.tsx`
- Create: `app/(admin)/admin/layout.test.tsx`

**Interfaces:** none exported — these are Next.js layout components picked up by file convention.

AGENTS.md §4.2 requires `.seeker-scope`/`.insider-scope` classes; the codebase currently has `.referrer-scope` (a locked-vocabulary violation — AGENTS.md §0.4). This task renames it as part of building the layouts that consume it. No child pages exist yet inside `(seeker)`/`(insider)`/`(admin)` (they land in Phase 1), so these layouts render only their shell (nav + scope class) — session-based auth redirects are Phase 1 work, wired once `/login` and the real `identity` module exist; adding a stub session check now with nothing to protect and no real redirect target would be speculative code with no test that can meaningfully exercise it.

- [ ] **Step 1: Rename `.referrer-scope` to `.insider-scope`**

In `app/globals.css`, rename the selector and every rule that targets it:
```css
.insider-scope {
  --primary:        var(--amber-500);
  --primary-hover:  var(--amber-600);
  --primary-soft:   var(--amber-50);
  --primary-shadow: var(--shadow-amber);
}
```
and (further down, in the "TWO SIDES" section) rename `.side.referrer` to `.side.insider` in all four of its rules:
```css
.side.insider { background: linear-gradient(170deg,var(--amber-50) 0%,#fff 65%); border-color: var(--amber-200); }
```
```css
.side.insider .side-for { color: var(--amber-600); }
```
```css
.side.insider .side-cta { background: var(--amber-500); color: #fff; box-shadow: var(--shadow-amber); }
.side.insider .side-cta:hover { background: var(--amber-600); }
```
(The `HowItWorks.tsx` component that uses the `side referrer` class name is fixed in Task 9, alongside the rest of the vocabulary sweep, so both sides of the rename land together conceptually even though the CSS selector itself is renamed here.)

- [ ] **Step 2: Write app-shell CSS**

Append to `app/globals.css`:
```css
.app-shell { min-height: 100vh; display: flex; flex-direction: column; padding-bottom: 64px; }
.app-shell-main { flex: 1; }
.app-shell-bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; justify-content: space-around;
  background: var(--bg-card); border-top: 0.5px solid var(--border);
  padding: 10px 0; z-index: 40;
}
.app-shell-bottom-nav a { color: var(--fg-2); font-size: var(--fs-small); text-decoration: none; }
.admin-shell { padding: 24px; max-width: 1280px; margin: 0 auto; }
```

- [ ] **Step 3: Write the failing seeker layout test**

Create `app/(seeker)/layout.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SeekerLayout from "./layout";

describe("SeekerLayout", () => {
  it("wraps children in the seeker scope with the bottom nav", () => {
    render(
      <SeekerLayout>
        <p>Dashboard content</p>
      </SeekerLayout>
    );
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insiders" })).toHaveAttribute("href", "/insiders");
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then write `app/(seeker)/layout.tsx`**

Run: `npx vitest run "app/(seeker)/layout.test.tsx"` — expect FAIL.

```tsx
import type { ReactNode } from "react";
import Link from "next/link";

export default function SeekerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/dashboard">Home</Link>
        <Link href="/insiders">Insiders</Link>
        <Link href="/requests">Requests</Link>
        <Link href="/profile">Profile</Link>
      </nav>
    </div>
  );
}
```

Run: `npx vitest run "app/(seeker)/layout.test.tsx"` — expect PASS (1 test).

- [ ] **Step 5: Write the failing insider layout test and implementation**

Create `app/(insider)/layout.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InsiderLayout from "./layout";

describe("InsiderLayout", () => {
  it("wraps children in the insider scope with the bottom nav", () => {
    render(
      <InsiderLayout>
        <p>Inbox content</p>
      </InsiderLayout>
    );
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rewards" })).toHaveAttribute("href", "/rewards");
  });
});
```

Run: `npx vitest run "app/(insider)/layout.test.tsx"` — expect FAIL.

Create `app/(insider)/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import Link from "next/link";

export default function InsiderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="insider-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/dashboard">Home</Link>
        <Link href="/requests">Inbox</Link>
        <Link href="/rewards">Rewards</Link>
        <Link href="/profile">Profile</Link>
      </nav>
    </div>
  );
}
```

Run: `npx vitest run "app/(insider)/layout.test.tsx"` — expect PASS (1 test).

- [ ] **Step 6: Write the failing admin layout test and implementation**

Create `app/(admin)/admin/layout.test.tsx`:
```tsx
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
```

Run: `npx vitest run "app/(admin)/admin/layout.test.tsx"` — expect FAIL.

Create `app/(admin)/admin/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-shell">{children}</div>;
}
```

Run: `npx vitest run "app/(admin)/admin/layout.test.tsx"` — expect PASS (1 test).

- [ ] **Step 7: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
```bash
git add app/globals.css "app/(seeker)" "app/(insider)" "app/(admin)"
git commit -m "feat(shell): add role-scoped app shell layouts, rename .referrer-scope to .insider-scope"
```

---

## Task 8: Brand config wiring

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/(public)/page.tsx`
- Modify: `components/Nav.tsx`
- Create: `components/Nav.test.tsx`
- Modify: `components/Footer.tsx`
- Create: `components/Footer.test.tsx`
- Modify: `components/WaitlistForm.tsx`

**Interfaces:**
- Consumes: `brand` from `src/config/brand.ts` (built in the companion backend plan's Task 2 — if that task has not run yet in this worktree, this task blocks on it; ask the controller rather than duplicating `brand.ts` here).

This directly implements AGENTS.md §0.2 ("Never hard-code the brand; use `src/config/brand.ts`") and the Phase 0 frontend backlog bullet "brand config wiring".

- [ ] **Step 1: Write the failing Nav test**

Create `components/Nav.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/Nav.test.tsx`
Expected: FAIL — `Nav.tsx` currently hard-codes `alt="getnudgd"`.

- [ ] **Step 3: Update `components/Nav.tsx`**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/Nav.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing Footer test**

Create `components/Footer.test.tsx`:
```tsx
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run components/Footer.test.tsx`
Expected: FAIL — `Footer.tsx` currently hard-codes the URLs.

- [ ] **Step 7: Update `components/Footer.tsx`**

Replace the two hard-coded `href` values with `brand.social.linkedin` and `brand.social.instagram`:
```tsx
import { brand } from "@/src/config/brand";

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner foot-social-row">
        <a
          href={brand.social.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="foot-social"
          aria-label="LinkedIn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          LinkedIn
        </a>
        <a
          href={brand.social.instagram}
          target="_blank"
          rel="noopener noreferrer"
          className="foot-social"
          aria-label="Instagram"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
          </svg>
          Instagram
        </a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run components/Footer.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Wire brand into `app/layout.tsx`, `app/(public)/page.tsx`, and `WaitlistForm.tsx`**

In `app/layout.tsx`, replace the hard-coded metadata with `brand`-derived values:
```tsx
import { brand } from "@/src/config/brand";
// ...
export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: `${brand.name} | ${brand.ctaGetVouched} by verified employees`,
  description: `${brand.tagline} ${brand.ctaGetVouched} by verified employees at top Indian startups. Join the waitlist.`,
  openGraph: {
    title: brand.name,
    description: `${brand.ctaGetVouched} by someone on the inside.`,
    url: brand.url,
    siteName: brand.name,
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};
```

In `app/(public)/page.tsx`, use the same brand-derived title/description instead of the literal string written in Task 2:
```tsx
import { brand } from "@/src/config/brand";
// ...
export const metadata = {
  title: `${brand.name} | ${brand.ctaGetVouched} by verified employees`,
  description: `${brand.tagline} ${brand.ctaGetVouched} by verified employees at top Indian startups. Join the waitlist.`,
};
```

In `components/WaitlistForm.tsx`, derive the WhatsApp share message from `brand` instead of the hard-coded string:
```tsx
import { brand } from "@/src/config/brand";

const WA_MESSAGE = encodeURIComponent(
  `Hey! I just joined the ${brand.name} waitlist. ${brand.ctaGetVouched} at your dream company 👉 ${brand.domain}`
);
const WA_LINK = `https://wa.me/?text=${WA_MESSAGE}`;
```

- [ ] **Step 10: Verify the full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
Start `npm run dev` in the background and confirm `/` still returns `200` and the page `<title>` contains "GetNudgd" (via `curl -s http://localhost:3000/ | grep -o "<title>[^<]*"`). Stop the dev server afterward.
```bash
git add app/layout.tsx "app/(public)/page.tsx" components/Nav.tsx components/Nav.test.tsx components/Footer.tsx components/Footer.test.tsx components/WaitlistForm.tsx
git commit -m "feat(brand): wire src/config/brand.ts into layout metadata, Nav, Footer, and WaitlistForm"
```

---

## Task 9: Locked-vocabulary sweep, honeypot field, remove `x-api-secret` header

**Files:**
- Modify: `components/WaitlistForm.tsx`
- Modify: `components/HowItWorks.tsx`
- Modify: `components/SocialProof.tsx`
- Modify: `components/survey/SurveyShell.tsx`
- Modify: `app/(public)/survey/page.tsx`

**Interfaces:** none new — this task only changes copy, class names, and wire-level string values in existing components.

This closes out AGENTS.md §0.4 across the marketing site (the sweep in Task 2 only touched page-level metadata) and the frontend half of AGENTS.md §3.9's known-defect removal (the backend half — deleting `lib/api-security.ts` and rewriting the API routes to use same-origin checks + a honeypot field — is the companion backend plan's Task 12). The `x-api-secret` header these components currently send is no longer checked by the backend once that task lands; sending it is now dead code. The honeypot field this task adds is the `website` field the backend routes already treat specially.

- [ ] **Step 1: Update `components/WaitlistForm.tsx`**

Change the role type, wire value, and remove the now-unused security header; add the hidden honeypot input:
```tsx
"use client";

import { useState } from "react";
import { brand } from "@/src/config/brand";

const WA_MESSAGE = encodeURIComponent(
  `Hey! I just joined the ${brand.name} waitlist. ${brand.ctaGetVouched} at your dream company 👉 ${brand.domain}`
);
const WA_LINK = `https://wa.me/?text=${WA_MESSAGE}`;

type Variant = "hero" | "cta";

export function WaitlistForm({ variant = "hero" }: { variant?: Variant }) {
  const [role, setRole] = useState<"seeker" | "insider">("seeker");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: real users never see or fill this
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shaking, setShaking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = email.trim();
    if (!val.includes("@") || !val.includes(".")) {
      setShaking(true);
      return;
    }
    setLoading(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: val,
          userType: role,
          website,
        }),
      });
    } catch {
      // fail silently — still show success to user
    }
    setLoading(false);
    setSuccess(true);
  }

  function handleShakeEnd() {
    setShaking(false);
  }

  const isCta = variant === "cta";

  return (
    <div className={isCta ? "cta-form" : ""}>
      {!success ? (
        <>
          <div className="role-toggle" role="tablist">
            <button
              type="button"
              className={`role-btn ${role === "seeker" ? "active" : ""}`}
              onClick={() => setRole("seeker")}
            >
              Looking for a job
            </button>
            <button
              type="button"
              className={`role-btn ${role === "insider" ? "active" : ""}`}
              onClick={() => setRole("insider")}
            >
              I&apos;m an Insider
            </button>
          </div>
          <form
            className={`email-row${shaking ? " shake" : ""}`}
            onSubmit={handleSubmit}
            onAnimationEnd={handleShakeEnd}
            noValidate
          >
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
            />
            <input
              className="email-input"
              type="email"
              placeholder="your@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "Joining…" : isCta ? "Subscribe" : "Notify me"}
            </button>
          </form>
        </>
      ) : (
        <div className="wl-success">
          <svg className="checkmark-svg" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle className="checkmark-circle" cx="24" cy="24" r="20" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" />
            <path className="checkmark-tick" d="M15 24.5 L21 30.5 L33 18" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="ok">{isCta ? "Done. We'll be in touch." : "You're on the list."}</h3>
          <p>
            {isCta
              ? "One email. When we're ready. That's the only promise we're making."
              : "We'll reach out the moment GetNudgd is ready. No noise in between."}
          </p>
          <div className="wl-share-row">
            <span className="wl-share-label">Share with a friend who needs this →</span>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="btn-wa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `components/HowItWorks.tsx`**

Change the `h2` copy, the `side referrer` class name, and the "For referrers" label:
- `<h2>Job seeker or referrer, you both win</h2>` → `<h2>Seeker or Insider, you both win</h2>`
- `<div className="side referrer">` → `<div className="side insider">`
- `<span className="side-for">For referrers</span>` → `<span className="side-for">For Insiders</span>`

- [ ] **Step 3: Update `components/SocialProof.tsx`**

Change `refund if your referrer does not act` → `refund if your Insider does not act`.

- [ ] **Step 4: Update `components/survey/SurveyShell.tsx`**

- `SECTION_META[16]`: `name: "Referrer Side"` → `name: "Insider Side"`, `desc: "Questions 16–19, If you were the referrer"` → `desc: "Questions 16–19, If you were the Insider"`.
- The `// ── Section E: Referrer Side ──` comment → `// ── Section E: Insider Side ──`.
- Question 16's text: `"If you're employed, would you sign up as a referrer on GetNudgd and earn ₹1,500–₹10,000 per person you successfully get hired?"` → `"If you're employed, would you sign up as an Insider on GetNudgd and earn ₹1,500–₹10,000 per person you successfully get hired?"`.
- Remove the `x-api-secret` header from the survey's submit `fetch` call (mirrors the WaitlistForm change in Step 1) and add the same hidden honeypot `website` field wired into the submitted payload, consistent with `SurveyShell`'s existing state-management pattern for form fields.

- [ ] **Step 5: Update `app/(public)/survey/page.tsx` metadata**

Change the description to avoid "referral": `"Help us build GetNudgd. Answer 21 quick questions and get early access."` (already applied in Task 2 — confirm it is present; if Task 2 ran before this wording was finalized, update it now).

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Run a final repo-wide check that no disallowed terms remain in runtime code (docs like `PRD.md`/`TRD.md` are historical and out of scope):
```bash
grep -rn "referrer\|job_seeker" app components --include="*.tsx" --include="*.ts" | grep -v "noreferrer"
```
Expected: no output.
Start `npm run dev` in the background, visit `/` and `/survey` via curl to confirm both still return `200`, then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add components app/\(public\)/survey/page.tsx
git commit -m "fix(vocab): sweep referrer/job_seeker to insider/seeker, add honeypot, drop x-api-secret header"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every bullet in AGENTS.md §4.9 Phase 0 frontend backlog has a task — move survey/landing into `app/(public)` with `/` as landing (Task 2), `components/ui` primitives (Tasks 3–6, covering all thirteen primitives named in §4.6), role-scoped app shell layouts (Task 7), brand config wiring (Task 8). The vocabulary sweep (Task 9) and the frontend half of known-defect removal are not separate backlog bullets but are required by AGENTS.md §0.4/§3.9/Part 2.12 ("Locked vocabulary and config-not-code apply everywhere") and are coordinated with the companion backend plan's Task 12.
- **Deliberately deferred, with rationale stated in Global Constraints/Task 7:** session-based auth redirects in the `(seeker)`/`(insider)`/`(admin)` layouts (no `/login` page or real `identity` module exists until Phase 1); any `components/ui` primitive not named in AGENTS.md §4.6 (e.g. a data table) — none is needed until a Phase 1 screen calls for it.
- **Cross-plan dependency:** Task 8 (brand wiring) and Nav/Footer tests both import `@/src/config/brand`, which is created by the companion backend plan's Task 2, not this plan. If the two plans run in parallel worktrees, Task 8 here should not start until that backend task has landed on the integration branch (AGENTS.md §6.4: parallel tracks require the shared piece — here, `brand.ts` — to exist first). Tasks 1–7 and 9 have no such dependency and can run in any order relative to the backend plan.
- **Type consistency:** `role: "seeker" | "insider"` in `WaitlistForm.tsx` (Task 9) matches the `userType === "insider" ? "insider" : "seeker"` mapping in the companion backend plan's Task 12 waitlist route — both sides of the wire agree on `"seeker"`/`"insider"` as the only values.
