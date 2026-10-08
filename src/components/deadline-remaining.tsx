"use client";
import { useT } from "./language";
import { useEffect, useState } from "react";
import { deadlineRemaining } from "@/lib/domain";
export default function DeadlineRemaining({
  deadline,
  status,
}: {
  deadline: string | null;
  status: string;
}) {
  const tr = useT();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return <span>{tr(deadlineRemaining(deadline, status, now))}</span>;
}
