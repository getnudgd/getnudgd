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
  const [now, setNow] = useState(() => serverNow.getTime());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + clientOffsetMs), 30_000);
    return () => clearInterval(id);
  }, [clientOffsetMs]);

  const remaining = deadline.getTime() - now;
  return <span className="ui-countdown">{formatRemaining(remaining)}</span>;
}
