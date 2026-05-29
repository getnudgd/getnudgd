"use client";

import { useState, useRef, useEffect } from "react";
import { ChipSelect } from "./ChipSelect";
import { StarRating } from "./StarRating";
import { EmojiScale } from "./EmojiScale";
import { ThankYou } from "./ThankYou";

const TOTAL = 21;
const MANDATORY = [1, 2, 3, 4, 5, 6]; // Q1–Q6

const SECTIONS: Record<number, { letter: string; name: string; desc: string }> = {
  1:  { letter: "A", name: "About You",               desc: "Questions 1–7, Building your profile" },
  8:  { letter: "B", name: "Job Search Reality",       desc: "Questions 8–11, Your pain points" },
  12: { letter: "C", name: "GetNudgd Concept Fit",     desc: "Questions 12–14, Does this solve your problem?" },
  15: { letter: "D", name: "Pricing",                  desc: "Question 15, What you'd pay" },
  16: { letter: "E", name: "Referrer Side",            desc: "Questions 16–19, If you were the referrer" },
  20: { letter: "F", name: "Open Feedback & Contact",  desc: "Questions 20–21, Your voice + early access" },
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
  const textRefs = useRef<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>({});

  // Sync text field answer on blur / before navigate
  function syncText(qNum: number) {
    const el = textRefs.current[qNum];
    if (el) {
      setAnswers((prev) => ({ ...prev, [`q${qNum}`]: el.value.trim() }));
    }
  }

  function setAnswer(qNum: number, val: string | string[] | number) {
    setAnswers((prev) => ({ ...prev, [`q${qNum}`]: val }));
  }

  function navigate(dir: 1 | -1) {
    syncText(current);

    if (dir === 1 && MANDATORY.includes(current)) {
      const val = answers[`q${current}`];
      const textEl = textRefs.current[current];
      const textVal = textEl ? textEl.value.trim() : "";
      const answered = textVal
        ? true
        : val !== undefined && val !== null && val !== "" && !(Array.isArray(val) && val.length === 0);

      if (!answered) {
        setErrorQ(current);
        setTimeout(() => setErrorQ(null), 1500);
        return;
      }
    }

    if (dir === 1 && current === TOTAL) {
      handleSubmit();
      return;
    }

    const next = Math.max(1, Math.min(TOTAL, current + dir));
    setCurrent(next);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  async function handleSubmit() {
    syncText(current);
    setSubmitted(true);
    try {
      await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, submittedAt: new Date().toISOString() }),
      });
    } catch {
      // fail silently
    }
  }

  const progress = Math.round(((current - 1) / TOTAL) * 100);
  const section = SECTIONS[current];

  if (!started) {
    return (
      <div id="intro-screen" style={{ textAlign: "center", padding: "16px 0 40px" }}>
        <div className="survey-logo">
          <span className="logo-get">get</span>
          <span className="logo-nudgd">nudgd</span>
        </div>
        <div className="intro-tag">Pre-Launch Survey</div>
        <h1 className="intro-h1">
          Job hunting feels
          <br />
          <span>broken. Help us fix it.</span>
        </h1>
        <p className="intro-sub">
          Your answers go directly to the founders. No fluff, just honest
          questions about what job hunting in India actually feels like.
        </p>
        <div className="intro-meta">
          <div className="intro-meta-item">🔒 Anonymous</div>
          <div className="intro-meta-item">🎁 Early access on completion</div>
        </div>
        <button className="btn-start" onClick={() => setStarted(true)}>
          Let&apos;s Go →
        </button>
      </div>
    );
  }

  if (submitted) {
    return <ThankYou />;
  }

  return (
    <div id="survey-screen">
      {/* Progress */}
      <div className="progress-wrap">
        <div className="progress-label">
          <span />
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
        />
        {MANDATORY.includes(current) && (
          <div className="req-msg">Please answer this question to continue.</div>
        )}
      </div>

      {/* Navigation */}
      <div className="nav-row">
        <button
          className="btn-back"
          onClick={() => navigate(-1)}
          disabled={current === 1}
        >
          ← Back
        </button>
        <button className="btn-next" onClick={() => navigate(1)}>
          {current === TOTAL ? "Submit 🚀" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

/* ─── Individual question renderer ─── */
function QuestionContent({
  qNum,
  answers,
  setAnswer,
  textRefs,
}: {
  qNum: number;
  answers: Answers;
  setAnswer: (q: number, v: string | string[] | number) => void;
  textRefs: React.MutableRefObject<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>;
}) {
  const num = String(qNum).padStart(2, "0");

  const questions: Record<
    number,
    { text: string; sub?: string; content: React.ReactNode }
  > = {
    1: {
      text: "What's your name?",
      sub: "First name is fine.",
      content: (
        <input
          className="q-input"
          type="text"
          placeholder="e.g. Arjun"
          maxLength={50}
          defaultValue={String(answers.q1 || "")}
          ref={(el) => { textRefs.current[1] = el; }}
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
          className="q-input"
          type="text"
          placeholder="e.g. Bengaluru, Hyderabad, Pune, Delhi…"
          maxLength={80}
          defaultValue={String(answers.q3 || "")}
          ref={(el) => { textRefs.current[3] = el; }}
        />
      ),
    },
    4: {
      text: "What is your current job status?",
      content: (
        <ChipSelect
          options={[
            { value: "Employed full time",        label: "💼 Employed, full time" },
            { value: "Fresher / final year student", label: "🎓 Fresher / final year student" },
            { value: "Freelancer / consultant",    label: "🧑‍💻 Freelancer / consultant" },
            { value: "Between jobs",               label: "🔍 Currently between jobs" },
            { value: "Pursuing higher studies",    label: "📚 Pursuing higher studies" },
          ]}
          selected={(answers.q4 as string) || ""}
          onChange={(v) => setAnswer(4, v)}
        />
      ),
    },
    5: {
      text: "What's your domain / field of work?",
      content: (
        <ChipSelect
          options={[
            { value: "Software Engineering",     label: "💻 Software Engineering" },
            { value: "Data / Analytics / AI",    label: "📊 Data / Analytics / AI" },
            { value: "Product or Design",        label: "🧩 Product or Design" },
            { value: "Marketing or Sales",       label: "📣 Marketing or Sales" },
            { value: "Finance / HR / Ops / Other", label: "💼 Finance / HR / Ops / Other" },
          ]}
          selected={(answers.q5 as string) || ""}
          onChange={(v) => setAnswer(5, v)}
        />
      ),
    },
    6: {
      text: "What is your current annual salary (CTC)?",
      sub: "Helps us understand who needs this most.",
      content: (
        <ChipSelect
          options={[
            { value: "Below ₹3L",   label: "Below ₹3L" },
            { value: "₹3L–₹7L",    label: "₹3L–₹7L" },
            { value: "₹7L–₹10L",   label: "₹7L–₹10L" },
            { value: "₹10L–₹15L",  label: "₹10L–₹15L" },
            { value: "₹15L–₹25L",  label: "₹15L–₹25L" },
            { value: "Above ₹25L", label: "Above ₹25L" },
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
        <ChipSelect
          options={[
            { value: "Big tech / FAANG",            label: "🚀 Big tech / FAANG" },
            { value: "High-growth Indian startup",  label: "🔥 High-growth Indian startup" },
            { value: "MNC / large enterprise",      label: "🏢 MNC / large enterprise" },
            { value: "Career switch",               label: "🔄 Career switch to new domain" },
            { value: "Not looking actively",        label: "😌 Not actively looking right now" },
          ]}
          selected={(answers.q7 as string) || ""}
          onChange={(v) => setAnswer(7, v)}
        />
      ),
    },
    8: {
      text: "In the last 6 months, how many job applications have you sent and heard nothing back from?",
      content: (
        <ChipSelect
          options={[
            { value: "Haven't applied yet",       label: "Haven't applied anywhere yet" },
            { value: "1–5 times",                  label: "1–5 times" },
            { value: "5–15, mostly ghosted",       label: "5–15 times, mostly ghosted" },
            { value: "15–30, very few responses",  label: "15–30 times, very few responses" },
            { value: "30+, deeply frustrated",     label: "30+ times, deeply frustrated" },
          ]}
          selected={(answers.q8 as string) || ""}
          onChange={(v) => setAnswer(8, v)}
        />
      ),
    },
    9: {
      text: "Why do you think your applications don't convert into interviews?",
      sub: "Pick everything that rings true.",
      content: (
        <ChipSelect
          multi
          options={[
            { value: "Resume not tailored",  label: "Resume not tailored to each job" },
            { value: "ATS filters me out",   label: "ATS filters me before any human sees it" },
            { value: "No referral inside",   label: "No connection or referral inside the company" },
            { value: "Too many applicants",  label: "Too many applicants for the same role" },
            { value: "Skills mismatch",      label: "My skills don't match the JD perfectly" },
            { value: "Wrong platforms",      label: "Applying on wrong platforms" },
            { value: "Don't know",           label: "I honestly don't know" },
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
            { value: "Yes, always",             label: "Yes, I always do this" },
            { value: "Sometimes, takes too long", label: "Sometimes, but it takes way too long" },
            { value: "Rarely, don't know how",  label: "Rarely, don't really know how to" },
            { value: "Never, one resume for all", label: "Never, one resume for everything" },
            { value: "I use AI tools for it",   label: "I use AI tools to do it" },
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
            { value: "Yes, got the job",          label: "Yes, referral led to a job or interview" },
            { value: "Got referred, didn't convert", label: "Got referred but it didn't convert" },
            { value: "Never been referred",       label: "Never been referred" },
            { value: "Tried, felt awkward",       label: "Tried to ask someone but felt too awkward" },
            { value: "Didn't know it mattered",   label: "Didn't know referrals mattered this much" },
          ]}
          selected={(answers.q11 as string) || ""}
          onChange={(v) => setAnswer(11, v)}
        />
      ),
    },
    12: {
      text: "Now that you've seen how GetNudgd works, what's your gut reaction?",
      sub: "Core idea: pay a small fee to get a verified employee at your target company to refer you internally.",
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
      text: "Imagine you paste a job link on our platform and get back a fully tailored resume in under 2 minutes, completely free. How useful is that to you personally?",
      sub: "1 = Useless → 5 = I'd use this every single time I apply",
      content: (
        <StarRating
          value={(answers.q13 as number) || null}
          onChange={(v) => setAnswer(13, v)}
        />
      ),
    },
    14: {
      text: "What's your biggest concern about whether GetNudgd would actually work?",
      sub: "This one shapes everything we build. Be straight with us.",
      content: (
        <ChipSelect
          options={[
            { value: "Referrers take money, do nothing", label: "Referrers might take money and do nothing" },
            { value: "Employees not verified",           label: "Are the employees even real or verified?" },
            { value: "HR rejects anyway",                label: "Company HR might reject referred profiles anyway" },
            { value: "Resume data privacy",              label: "What happens to my resume data?" },
            { value: "Feels ethically wrong",            label: "Paying for referrals feels ethically wrong" },
            { value: "No concerns",                      label: "No major concerns, sounds legit ✅" },
          ]}
          selected={(answers.q14 as string) || ""}
          onChange={(v) => setAnswer(14, v)}
        />
      ),
    },
    15: {
      text: "How much would you pay for a single referral request at a top company like Google, Zepto, or CRED?",
      content: (
        <ChipSelect
          options={[
            { value: "₹0, won't pay",          label: "₹0, I won't pay" },
            { value: "₹50–₹150",               label: "₹50–₹150" },
            { value: "₹150–₹350",              label: "₹150–₹350" },
            { value: "₹350–₹600",              label: "₹350–₹600" },
            { value: "₹600–₹1,000",            label: "₹600–₹1,000" },
            { value: "₹1,000+ if guaranteed",  label: "₹1,000+ if outcome is guaranteed" },
          ]}
          selected={(answers.q15 as string) || ""}
          onChange={(v) => setAnswer(15, v)}
        />
      ),
    },
    16: {
      text: "If you're employed, would you sign up as a referrer on GetNudgd and earn ₹1,500–₹10,000 per person you successfully get hired?",
      content: (
        <ChipSelect
          options={[
            { value: "Yes, great side income",  label: "💸 Yes, great side income" },
            { value: "Yes, if I can screen",    label: "Yes, only if I can screen candidates" },
            { value: "Maybe, check policy",     label: "Maybe, need to check company policy" },
            { value: "No, reputation risk",     label: "No, worried about my reputation" },
            { value: "Fresher, not applicable", label: "I'm a fresher, not applicable" },
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
            { value: "Weak profile embarrasses me",  label: "Their weak profile might embarrass me" },
            { value: "Company policy",               label: "My company may have a policy against this" },
            { value: "Responsible if they perform badly", label: "I don't want to be responsible if they perform badly" },
            { value: "Person might misrepresent",    label: "What if the person misrepresents themselves?" },
            { value: "No concern",                   label: "No real concern, I'd refer anyone who looks good on paper" },
            { value: "Only personally vetted",       label: "I'd only refer people I've personally vetted" },
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
            { value: "No limit",              label: "No limit that I know of" },
            { value: "1–2 per month",         label: "1–2 per month" },
            { value: "3–5 per month",         label: "3–5 per month" },
            { value: "More than 5, encouraged", label: "More than 5, they actively encourage it" },
            { value: "Not sure",              label: "Not sure, haven't checked" },
            { value: "Doesn't allow",         label: "My company doesn't allow external referrals at all" },
          ]}
          selected={(answers.q18 as string) || ""}
          onChange={(v) => setAnswer(18, v)}
        />
      ),
    },
    19: {
      text: "What would make you feel comfortable referring a stranger through a platform like GetNudgd?",
      sub: "Pick everything that would matter to you.",
      content: (
        <ChipSelect
          multi
          options={[
            { value: "See full resume before accepting",  label: "Seeing their full resume before accepting" },
            { value: "Rating system on candidates",       label: "A rating or review system on candidates" },
            { value: "Can decline without penalty",       label: "Knowing I can decline without any penalty" },
            { value: "My identity stays private",         label: "My identity stays private from the candidate" },
            { value: "Platform verifies candidate identity", label: "Platform has verified the candidate's identity" },
            { value: "Seeker gets credits back if I decline", label: "Job seeker gets credits back if I decline" },
          ]}
          selected={(answers.q19 as string[]) || []}
          onChange={(v) => setAnswer(19, v)}
        />
      ),
    },
    20: {
      text: "What is the ONE thing GetNudgd must get right to earn your trust, and your money?",
      sub: "Goes straight to the founders. Say exactly what you think.",
      content: (
        <TextareaQ
          qNum={20}
          maxLength={400}
          placeholder="e.g. Full refund if no response, proof that referral was actually submitted, verified company emails only…"
          defaultValue={String(answers.q20 || "")}
          textRefs={textRefs}
        />
      ),
    },
    21: {
      text: "Want to be first in line when GetNudgd launches?",
      sub: "Early access + bonus credits the day we launch.",
      content: (
        <>
          <input
            className="q-input"
            type="text"
            placeholder="Email or WhatsApp number"
            maxLength={100}
            defaultValue={String(answers.q21_contact || "")}
            ref={(el) => { textRefs.current[211] = el; }}
            style={{ marginBottom: 18 }}
          />
          <div
            style={{
              color: "var(--ink-500)",
              fontSize: 13,
              marginBottom: 10,
            }}
          >
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
        {!MANDATORY.includes(qNum) && (
          <span className="opt-tag">optional</span>
        )}
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
}: {
  qNum: number;
  maxLength: number;
  placeholder: string;
  defaultValue: string;
  textRefs: React.MutableRefObject<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>;
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
        onChange={(e) => setCount(e.target.value.length)}
      />
      <div className="char-count">
        <span>{count}</span> / {maxLength}
      </div>
    </>
  );
}
