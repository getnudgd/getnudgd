"use client";

import { useState, useRef } from "react";
import { ChipSelect } from "./ChipSelect";
import { StarRating } from "./StarRating";
import { EmojiScale } from "./EmojiScale";
import { ThankYou } from "./ThankYou";

const TOTAL = 21;
// Q1–Q7 are all mandatory (change 3: extended from Q6 to Q7)
const MANDATORY = [1, 2, 3, 4, 5, 6, 7];
// Text-input question numbers
const TEXT_QS = [1, 3, 20];

const SECTIONS: Record<number, { letter: string; name: string; desc: string }> = {
  1:  { letter: "A", name: "About You",              desc: "Questions 1–7, Building your profile" },
  8:  { letter: "B", name: "Job Search Reality",      desc: "Questions 8–11, Your pain points" },
  12: { letter: "C", name: "GetNudgd Concept Fit",    desc: "Questions 12–14, Does this solve your problem?" },
  15: { letter: "D", name: "Pricing",                 desc: "Question 15, What you'd pay" },
  16: { letter: "E", name: "Referrer Side",           desc: "Questions 16–19, If you were the referrer" },
  20: { letter: "F", name: "Open Feedback & Contact", desc: "Questions 20–21, Your voice + early access" },
};

type Answers = Record<string, string | string[] | number>;

function isAnswered(qNum: number, answers: Answers): boolean {
  const a = answers[`q${qNum}`];
  if (a === undefined || a === null || a === "") return false;
  if (Array.isArray(a)) return a.length > 0;
  return true;
}

export function SurveyShell() {
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(1);
  const [answers, setAnswers] = useState<Answers>({});
  const [errorQ, setErrorQ] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Bump this when any text input changes to trigger re-render for continue visibility
  const [inputTick, setInputTick] = useState(0);
  const textRefs = useRef<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>({});

  function onTextChange() {
    setInputTick((t) => t + 1);
  }

  function syncText(qNum: number) {
    const el = textRefs.current[qNum];
    if (el) setAnswers((prev) => ({ ...prev, [`q${qNum}`]: el.value.trim() }));
  }

  function setAnswer(qNum: number, val: string | string[] | number) {
    setAnswers((prev) => ({ ...prev, [`q${qNum}`]: val }));
  }

  // Returns true if the current question has been answered
  function isCurrentAnswered(): boolean {
    // Text questions: check the live ref value
    if (TEXT_QS.includes(current)) {
      const el = textRefs.current[current];
      return (el?.value.trim().length ?? 0) > 0;
    }
    // Q21 has both a text input (ref 211) and chips
    if (current === 21) {
      const contactEl = textRefs.current[211];
      return (
        (contactEl?.value.trim().length ?? 0) > 0 ||
        isAnswered(21, answers)
      );
    }
    return isAnswered(current, answers);
  }

  const isMandatory = MANDATORY.includes(current);
  const answered = isCurrentAnswered();
  // Mandatory Qs hide Continue until answered (live ref) OR already saved in state (back-nav)
  const continueVisible = !isMandatory || answered || isAnswered(current, answers);

  function navigate(dir: 1 | -1) {
    syncText(current);
    // Sync Q21 contact text
    const q21Contact = textRefs.current[211];
    if (q21Contact) setAnswers((prev) => ({ ...prev, q21_contact: q21Contact.value.trim() }));

    // Read live ref value at call-time — avoids stale-closure false negatives
    if (dir === 1 && isMandatory && !isCurrentAnswered()) {
      setErrorQ(current);
      setTimeout(() => setErrorQ(null), 1500);
      return;
    }

    if (dir === 1 && current === TOTAL) {
      handleSubmit();
      return;
    }

    const next = Math.max(1, Math.min(TOTAL, current + dir));
    setCurrent(next);
    setInputTick(0); // reset so next Q re-evaluates
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  async function handleSubmit() {
    // Collect all text ref values directly (state may be stale)
    const finalAnswers: Answers = { ...answers };
    for (const qNum of TEXT_QS) {
      const el = textRefs.current[qNum];
      if (el?.value.trim()) finalAnswers[`q${qNum}`] = el.value.trim();
    }
    const q21Contact = textRefs.current[211];
    if (q21Contact?.value.trim()) finalAnswers["q21_contact"] = q21Contact.value.trim();

    setSubmitted(true);

    try {
      const res = await fetch("/api/survey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": process.env.NEXT_PUBLIC_API_SECRET ?? "",
        },
        body: JSON.stringify({ answers: finalAnswers, submittedAt: new Date().toISOString() }),
      });
      if (!res.ok) console.error("[survey] API error:", res.status, await res.text());
    } catch (err) {
      console.error("[survey] Network error:", err);
    }
  }

  const progress = Math.round(((current - 1) / TOTAL) * 100);
  const section = SECTIONS[current];

  // ── INTRO SCREEN ──
  if (!started) {
    return (
      <div id="intro-screen" style={{ textAlign: "center", padding: "16px 0 40px" }}>
        {/* Change 8: logo removed — it lives in page.tsx above SurveyShell */}
        <div className="intro-tag">Pre-Launch Survey</div>
        {/* Change 7: heading split into two lines */}
        <h1 className="intro-h1">
          Job hunting feels broken.
          <br />
          <span>Help us fix it.</span>
        </h1>
        <p className="intro-sub">
          Your answers go directly to the founders. No fluff, just honest
          questions about what job hunting in India actually feels like.
        </p>
        {/* Change 6: removed Anonymous + Early access badges entirely */}
        <div className="intro-meta">
          <div className="intro-meta-item">⏱ ~3 minutes</div>

        </div>
        <button className="btn-start" onClick={() => setStarted(true)}>
          Let&apos;s Go →
        </button>
      </div>
    );
  }

  if (submitted) return <ThankYou />;

  return (
    <div id="survey-screen">
      {/* Progress */}
      <div className="progress-wrap">
        <div className="progress-label">
          <span>Question {current} of {TOTAL}</span>
          <span>{progress}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Section banner */}
      {section && (
        <div className="section-banner">
          <div className="section-letter">{section.letter}</div>
          <div>
            <div className="section-name">{section.name}</div>
            <div className="section-desc">{section.desc}</div>
          </div>
        </div>
      )}

      {/* Question card */}
      <div className={`q-card${errorQ === current ? " q-error shake" : ""}`}>
        <QuestionContent
          qNum={current}
          answers={answers}
          setAnswer={setAnswer}
          textRefs={textRefs}
          onTextChange={onTextChange}
        />
        {errorQ === current && (
          <div className="req-msg">Please answer this question to continue.</div>
        )}
      </div>

      {/* Navigation — Change 5: Continue fades in when answered */}
      <div className="nav-row">
        <button
          className="btn-back"
          onClick={() => navigate(-1)}
          disabled={current === 1}
        >
          ← Back
        </button>
        <button
          className={`btn-next${answered ? " btn-next-ready" : ""}`}
          onClick={() => navigate(1)}
          style={{
            opacity: continueVisible ? 1 : 0,
            pointerEvents: continueVisible ? "auto" : "none",
            transition: "opacity 0.2s ease",
          }}
        >
          {current === TOTAL ? "Submit 🚀" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

/* ─── Question renderer ─── */
function QuestionContent({
  qNum,
  answers,
  setAnswer,
  textRefs,
  onTextChange,
}: {
  qNum: number;
  answers: Answers;
  setAnswer: (q: number, v: string | string[] | number) => void;
  textRefs: React.MutableRefObject<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>;
  onTextChange: () => void;
}) {
  const num = String(qNum).padStart(2, "0");

  const questions: Record<number, { text: string; sub?: string; content: React.ReactNode }> = {
    // ── Section A: About You ──
    1: {
      // Change 3+8: Q1 is now mandatory (no opt-tag), logo removed above
      text: "What's your name?",
      sub: "First name is fine, we just want to know who we're building for.",
      content: (
        <input
          className="q-input" type="text" placeholder="e.g. Arjun" maxLength={50}
          defaultValue={String(answers.q1 || "")}
          ref={(el) => { textRefs.current[1] = el; }}
          onChange={onTextChange}
        />
      ),
    },
    2: {
      text: "How old are you?",
      content: (
        <ChipSelect
          options={[
            { value: "18–22", label: "18–22" },
            { value: "23–27", label: "23–27" },
            { value: "28–32", label: "28–32" },
            { value: "33–35", label: "33–35" },
            { value: "35+",   label: "35+" },
          ]}
          selected={(answers.q2 as string) || ""}
          onChange={(v) => setAnswer(2, v)}
        />
      ),
    },
    3: {
      text: "Which city are you based in?",
      content: (
        <input
          className="q-input" type="text"
          placeholder="e.g. Bengaluru, Hyderabad, Pune, Delhi…" maxLength={80}
          defaultValue={String(answers.q3 || "")}
          ref={(el) => { textRefs.current[3] = el; }}
          onChange={onTextChange}
        />
      ),
    },
    4: {
      text: "What is your current job status?",
      content: (
        // Change 4: emojis removed from labels
        <ChipSelect
          options={[
            { value: "Employed full time",           label: "Employed, full time" },
            { value: "Fresher / final year student",  label: "Fresher / final year student" },
            { value: "Freelancer / consultant",       label: "Freelancer / consultant" },
            { value: "Between jobs",                  label: "Currently between jobs" },
            { value: "Pursuing higher studies",       label: "Pursuing higher studies" },
          ]}
          selected={(answers.q4 as string) || ""}
          onChange={(v) => setAnswer(4, v)}
        />
      ),
    },
    5: {
      text: "What's your domain / field of work?",
      content: (
        // Change 4: emojis removed
        <ChipSelect
          options={[
            { value: "Software Engineering",       label: "Software Engineering" },
            { value: "Data / Analytics / AI",      label: "Data / Analytics / AI" },
            { value: "Product or Design",          label: "Product or Design" },
            { value: "Marketing or Sales",         label: "Marketing or Sales" },
            { value: "Finance / HR / Ops / Other", label: "Finance / HR / Ops / Other" },
          ]}
          selected={(answers.q5 as string) || ""}
          onChange={(v) => setAnswer(5, v)}
        />
      ),
    },
    6: {
      text: "What is your current annual salary (CTC)?",
      sub: "Helps us understand who values referrals the most.",
      content: (
        <ChipSelect
          options={[
            { value: "Below ₹3L",    label: "Below ₹3L" },
            { value: "₹3L–₹7L",     label: "₹3L–₹7L" },
            { value: "₹7L–₹15L",    label: "₹7L–₹15L" },
            { value: "₹15L–₹25L",   label: "₹15L–₹25L" },
            { value: "Above ₹25L",  label: "Above ₹25L" },
            { value: "No income yet", label: "No income yet" },
          ]}
          selected={(answers.q6 as string) || ""}
          onChange={(v) => setAnswer(6, v)}
        />
      ),
    },
    7: {
      text: "What kind of company are you looking to move into?",
      content: (
        // Change 4: emojis removed
        <ChipSelect
          options={[
            { value: "Big tech / FAANG",           label: "Big tech / FAANG" },
            { value: "High-growth Indian startup", label: "High-growth Indian startup" },
            { value: "MNC / large enterprise",     label: "MNC / large enterprise" },
            { value: "Career switch",              label: "Career switch to new domain" },
            { value: "Not looking actively",       label: "Not actively looking right now" },
          ]}
          selected={(answers.q7 as string) || ""}
          onChange={(v) => setAnswer(7, v)}
        />
      ),
    },

    // ── Section B: Job Search Reality ──
    8: {
      text: "In the last 6 months, how many job applications have you sent and heard nothing back from?",
      content: (
        <ChipSelect
          options={[
            { value: "Never applied",             label: "Haven't applied anywhere yet" },
            { value: "1–5 times",                 label: "1–5 times" },
            { value: "5–15, mostly ghosted",      label: "5–15 times, mostly ghosted" },
            { value: "15–30, very few responses", label: "15–30 times, very few responses" },
            { value: "30+, deeply frustrated",    label: "30+ times, deeply frustrated" },
          ]}
          selected={(answers.q8 as string) || ""}
          onChange={(v) => setAnswer(8, v)}
        />
      ),
    },
    9: {
      text: "Why do you think your applications don't convert into interviews?",
      sub: "Select all that apply.",
      content: (
        <ChipSelect
          multi
          options={[
            { value: "Resume not tailored", label: "Resume not tailored to each job" },
            { value: "ATS filters me out",  label: "ATS filters me before any human sees it" },
            { value: "No referral inside",  label: "No connection or referral inside the company" },
            { value: "Too many applicants", label: "Too many applicants for the same role" },
            { value: "Skills mismatch",     label: "My skills don't match the JD perfectly" },
            { value: "Wrong platforms",     label: "Applying on wrong platforms" },
            { value: "Don't know",          label: "I honestly don't know" },
          ]}
          selected={(answers.q9 as string[]) || []}
          onChange={(v) => setAnswer(9, v)}
        />
      ),
    },
    10: {
      text: "Have you ever customised your resume specifically for a job description before applying?",
      content: (
        <ChipSelect
          options={[
            { value: "Yes, always",               label: "Yes, I always do this" },
            { value: "Sometimes, takes too long",  label: "Sometimes, but it takes way too long" },
            { value: "Rarely, don't know how",    label: "Rarely, don't really know how to" },
            { value: "Never, one resume for all",  label: "Never, one resume for everything" },
            { value: "I use AI tools for it",     label: "I use AI tools to do it" },
          ]}
          selected={(answers.q10 as string) || ""}
          onChange={(v) => setAnswer(10, v)}
        />
      ),
    },
    11: {
      text: "Have you ever gotten a job or interview because someone referred you?",
      content: (
        <ChipSelect
          options={[
            { value: "Yes, got the job",             label: "Yes, referral led to a job or interview" },
            { value: "Got referred, didn't convert",  label: "Got referred but it didn't convert" },
            { value: "Never been referred",           label: "Never been referred" },
            { value: "Tried, felt awkward",           label: "Tried to ask someone but felt too awkward" },
            { value: "Didn't know it mattered",       label: "Didn't know referrals mattered this much" },
          ]}
          selected={(answers.q11 as string) || ""}
          onChange={(v) => setAnswer(11, v)}
        />
      ),
    },

    // ── Section C: Concept Fit ──
    12: {
      text: "Now that you've seen how GetNudgd works — what's your gut reaction?",
      sub: "Core idea: pay a small fee to get a verified employee at your target company to refer you internally.",
      // Change 4: emoji scale Q12 kept as-is
      content: (
        <EmojiScale
          options={[
            { value: "Need this now", emoji: "🔥", label: "Need this now" },
            { value: "Interesting",   emoji: "🤔", label: "Interesting" },
            { value: "Meh",           emoji: "😐", label: "Meh" },
            { value: "Skeptical",     emoji: "🧐", label: "Skeptical" },
            { value: "Not for me",    emoji: "👎", label: "Not for me" },
          ]}
          value={(answers.q12 as string) || ""}
          onChange={(v) => setAnswer(12, v)}
        />
      ),
    },
    13: {
      text: "Imagine you paste a job link on our platform and get back a fully tailored resume in under 2 minutes — completely free. How useful is that to you personally?",
      // Change 2: updated sub text to match reversed star order
      sub: "5 = I'd use this every single time I apply  →  1 = Useless",
      content: (
        // Change 2: StarRating now renders 5→1 with labels
        <StarRating
          value={(answers.q13 as number) || null}
          onChange={(v) => setAnswer(13, v)}
        />
      ),
    },
    14: {
      text: "What's your biggest concern about whether GetNudgd would actually work?",
      sub: "Most important question for us. Be honest.",
      content: (
        <ChipSelect
          options={[
            { value: "Referrers take money, do nothing", label: "Referrers might take money and do nothing" },
            { value: "Employees not verified",           label: "Are the employees even real or verified?" },
            { value: "HR rejects anyway",                label: "Company HR might reject referred profiles anyway" },
            { value: "Feels ethically wrong",            label: "Paying for referrals feels ethically wrong" },
            { value: "No concerns",                      label: "No major concerns, sounds legit" },
          ]}
          selected={(answers.q14 as string) || ""}
          onChange={(v) => setAnswer(14, v)}
        />
      ),
    },

    // ── Section D: Pricing ──
    15: {
      text: "How much would you pay for a single referral request at a top company like Google, Zepto, or CRED?",
      content: (
        <ChipSelect
          options={[
            { value: "₹0, won't pay",         label: "₹0, I won't pay" },
            { value: "₹50–₹200",              label: "₹50–₹200" },
            { value: "₹200–₹500",             label: "₹200–₹500" },
            { value: "₹500–₹1,000",           label: "₹500–₹1,000" },
            { value: "₹1,000+ if guaranteed", label: "₹1,000+ if outcome is guaranteed" },
          ]}
          selected={(answers.q15 as string) || ""}
          onChange={(v) => setAnswer(15, v)}
        />
      ),
    },

    // ── Section E: Referrer Side ──
    16: {
      text: "If you're employed — would you sign up as a referrer on GetNudgd and earn ₹1,500–₹10,000 per person you successfully get hired?",
      content: (
        // Change 4: emojis removed
        <ChipSelect
          options={[
            { value: "Yes, great side income",  label: "Yes, great side income" },
            { value: "Yes, if I can screen",    label: "Yes, only if I can screen candidates first" },
            { value: "Maybe, check policy",     label: "Maybe — need to check company policy" },
            { value: "No, reputation risk",     label: "No — worried about my reputation at work" },
            { value: "Fresher, not applicable", label: "I'm a fresher — not applicable" },
          ]}
          selected={(answers.q16 as string) || ""}
          onChange={(v) => setAnswer(16, v)}
        />
      ),
    },
    17: {
      text: "What would be your biggest concern about referring someone you don't know personally?",
      content: (
        <ChipSelect
          options={[
            { value: "Weak profile embarrasses me",       label: "Their weak profile might embarrass me at work" },
            { value: "Company policy against it",         label: "My company may have a policy against this" },
            { value: "Person might misrepresent",         label: "What if the person misrepresents themselves?" },
            { value: "Only personally vetted",            label: "I'd only refer people I've personally vetted" },
            { value: "No concern",                        label: "No real concern — I'd refer anyone who looks good" },
          ]}
          selected={(answers.q17 as string) || ""}
          onChange={(v) => setAnswer(17, v)}
        />
      ),
    },
    18: {
      text: "How many referrals does your company's internal policy typically allow per month?",
      content: (
        <ChipSelect
          options={[
            { value: "No limit",      label: "No limit that I know of" },
            { value: "1–2 per month", label: "1–2 per month" },
            { value: "3–5 per month", label: "3–5 per month" },
            { value: "Not sure",      label: "Not sure — haven't checked" },
            { value: "Doesn't allow", label: "My company doesn't allow external referrals at all" },
          ]}
          selected={(answers.q18 as string) || ""}
          onChange={(v) => setAnswer(18, v)}
        />
      ),
    },
    19: {
      text: "What would make you feel comfortable referring a stranger through a platform like GetNudgd?",
      sub: "Select all that apply.",
      content: (
        <ChipSelect
          multi
          options={[
            { value: "See full resume before accepting",     label: "Seeing their full resume before accepting" },
            { value: "Rating system on candidates",          label: "A rating or review system on candidates" },
            { value: "Can decline without penalty",          label: "Knowing I can decline without any penalty" },
            { value: "My identity stays private",            label: "My identity stays private from the candidate" },
            { value: "Platform verifies candidate",          label: "Platform has verified the candidate's identity" },
          ]}
          selected={(answers.q19 as string[]) || []}
          onChange={(v) => setAnswer(19, v)}
        />
      ),
    },

    // ── Section F: Open Feedback ──
    20: {
      text: "What is the ONE thing GetNudgd must get right to earn your trust — and your money?",
      sub: "This goes directly to the founders. Brutal honesty welcome.",
      content: (
        <TextareaQ
          qNum={20}
          maxLength={400}
          placeholder="e.g. Full refund if no response, proof that referral was actually submitted, verified company emails only…"
          defaultValue={String(answers.q20 || "")}
          textRefs={textRefs}
          onTextChange={onTextChange}
        />
      ),
    },
    21: {
      text: "Want to be first in line when GetNudgd launches?",
      sub: "Drop your email or WhatsApp — early access + bonus credits await.",
      content: (
        <>
          <input
            className="q-input" type="text"
            placeholder="Email or WhatsApp number" maxLength={100}
            defaultValue={String(answers.q21_contact || "")}
            ref={(el) => { textRefs.current[211] = el; }}
            style={{ marginBottom: 18 }}
            onChange={onTextChange}
          />
          <div style={{ color: "var(--ink-500)", fontSize: 13, marginBottom: 10, fontWeight: 500 }}>
            Where did you find this survey?
          </div>
          <ChipSelect
            options={[
              { value: "LinkedIn",            label: "LinkedIn" },
              { value: "WhatsApp group",      label: "WhatsApp group" },
              { value: "Instagram / Twitter", label: "Instagram / Twitter" },
              { value: "Friend / colleague",  label: "Friend / colleague" },
              { value: "College community",   label: "College community" },
              { value: "Other",               label: "Other" },
            ]}
            selected={(answers.q21 as string) || ""}
            onChange={(v) => setAnswer(21, v)}
          />
        </>
      ),
    },
  };

  const q = questions[qNum];
  if (!q) return null;

  return (
    <>
      <div className="q-number">{num}</div>
      <div className="q-text">
        {q.text}
      </div>
      {q.sub && <div className="q-sub">{q.sub}</div>}
      {q.content}
    </>
  );
}

/* ─── Textarea with char counter ─── */
function TextareaQ({
  qNum,
  maxLength,
  placeholder,
  defaultValue,
  textRefs,
  onTextChange,
}: {
  qNum: number;
  maxLength: number;
  placeholder: string;
  defaultValue: string;
  textRefs: React.MutableRefObject<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>;
  onTextChange: () => void;
}) {
  const [count, setCount] = useState(defaultValue.length);
  return (
    <>
      <textarea
        className="q-input"
        placeholder={placeholder}
        maxLength={maxLength}
        rows={4}
        defaultValue={defaultValue}
        ref={(el) => { textRefs.current[qNum] = el; }}
        onChange={(e) => { setCount(e.target.value.length); onTextChange(); }}
      />
      <div className="char-count">
        <span>{count}</span> / {maxLength}
      </div>
    </>
  );
}
