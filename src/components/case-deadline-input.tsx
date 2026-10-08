"use client";
import { useState } from "react";
import { useT } from "./language";
export default function CaseDeadlineInput({
  timezone,
  required = false,
}: {
  timezone: string;
  required?: boolean;
}) {
  const tr = useT(),
    [date, setDate] = useState(""),
    [time, setTime] = useState("08:05");
  return (
    <fieldset className="case-deadline-input">
      <legend>
        {tr("Срок")} · {timezone}
      </legend>
      <div className="form-row">
        <label>
          {tr("Дата")}
          <input
            type="date"
            required={required}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          {tr("Время")}
          <input
            type="time"
            required={!!date}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
      </div>
      <input
        name="deadline"
        type="hidden"
        value={date ? date + "T" + time : ""}
      />
    </fieldset>
  );
}
