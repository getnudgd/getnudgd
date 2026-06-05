"use client";

// Animation 1 — Hero headline staggered word reveal
// Each word fades in + slides up on page load, staggered 80ms apart.

import { useEffect, useState } from "react";

interface Line {
  words: string[];
  em?: boolean; // wrap line in <em> for indigo colour
}

interface AnimatedHeadlineProps {
  lines: Line[];
  className?: string;
}

export function AnimatedHeadline({ lines, className }: AnimatedHeadlineProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // rAF ensures we get the initial paint with opacity:0 before transition fires
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  let wordIndex = 0;

  return (
    <h1 className={className}>
      {lines.map((line, lineIdx) => {
        const lineWords = line.words.map((word) => {
          const delay = wordIndex++ * 80;
          const span = (
            <span
              key={word + delay}
              style={{
                display: "inline-block",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(20px)",
                transition: `opacity 0.5s ease-out ${delay}ms, transform 0.5s ease-out ${delay}ms`,
                willChange: "opacity, transform",
              }}
            >
              {word}
            </span>
          );
          return span;
        });

        // Join words with non-breaking space spans
        const joined = lineWords.reduce<React.ReactNode[]>((acc, el, i) => {
          if (i > 0) acc.push(<span key={`sp-${lineIdx}-${i}`}> </span>);
          acc.push(el);
          return acc;
        }, []);

        return (
          <span key={lineIdx} style={{ display: "block" }}>
            {line.em ? <em>{joined}</em> : joined}
          </span>
        );
      })}
    </h1>
  );
}
