import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overdue,
  parseDeadline,
  reminderTimes,
  deadlineRemaining,
} from "../src/lib/domain";
test("Overdue preserves In progress and excludes completed records", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  assert.equal(overdue("In progress", "2026-09-09", now), true);
  assert.equal(overdue("Completed", "2026-09-09", now), false);
  assert.equal(overdue("Cancelled", "2026-09-09", now), false);
  assert.equal(overdue("Visa approved", "2026-09-09", now), false);
  assert.equal(overdue("Visa refused", "2026-09-09", now), false);
});
test("Date-only deadline is 18:00 in company timezone", () => {
  assert.equal(
    parseDeadline("2026-09-12", "Asia/Tashkent")?.toISOString(),
    "2026-09-12T13:00:00.000Z",
  );
  assert.equal(parseDeadline("", "Asia/Tashkent"), null);
});
test("Today reminder is at 09:00 local time", () => {
  const times = reminderTimes(
    new Date("2026-09-12T13:00:00Z"),
    "Asia/Tashkent",
  );
  assert.equal(
    times.find((t) => t.kind === "today")?.at.toISOString(),
    "2026-09-12T04:00:00.000Z",
  );
  assert.equal(
    times.find((t) => t.kind === "before_3")?.at.toISOString(),
    "2026-09-09T13:00:00.000Z",
  );
});

test("Deadline countdown uses whole days, hours and overdue labels", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  const at = (hours: number) => new Date(now + hours * 3600000);
  for (const [hours, label] of [
    [24, "1 день"],
    [49, "2 дня"],
    [264, "11 дней"],
    [504, "21 день"],
    [23.9, "23 часа"],
    [1, "1 час"],
    [0.5, "Меньше часа"],
    [-48, "Просрочено: 2 дня"],
  ] as const)
    assert.equal(deadlineRemaining(at(hours), "New", now), label);
  assert.equal(deadlineRemaining(null, "New", now), "—");
  assert.equal(deadlineRemaining(at(-48), "Completed", now), "—");
  assert.equal(deadlineRemaining(at(-48), "Visa approved", now), "—");
  assert.equal(deadlineRemaining(at(-48), "Visa refused", now), "—");
});
