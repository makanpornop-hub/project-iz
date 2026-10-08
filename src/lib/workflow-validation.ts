type RecordValue = Record<string, any>;
export type WorkflowIssue = { id: string; message: string };
export function workflowIssues(wf: RecordValue): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  for (const g of wf.groups) {
    for (const f of g.fields) {
      if (f.required && !f.latest)
        issues.push({
          id: f.id,
          message: g.name + ": загрузите «" + f.name + "»",
        });
      else if (f.latest && f.latest.scan_status !== "clean")
        issues.push({
          id: f.id,
          message: g.name + ": дождитесь успешной проверки «" + f.name + "»",
        });
    }
    const sources = g.fields
      .filter((f: RecordValue) => f.merge_order)
      .sort((a: RecordValue, b: RecordValue) => a.merge_order - b.merge_order);
    if (
      sources.length &&
      (!sources.every((f: RecordValue) => f.latest) ||
        JSON.stringify(sources.map((f: RecordValue) => f.latest?.id)) !==
          JSON.stringify(g.output?.latest?.source_version_ids) ||
        g.output?.latest?.scan_status !== "clean")
    )
      issues.push({
        id: g.output?.id || g.id,
        message:
          g.name +
          ": объедините актуальные документы и дождитесь проверки результата",
      });
  }
  // Missing mandatory uploads come first, before merge and scan messages.
  const missing = new Set(
    wf.groups
      .flatMap((g: RecordValue) => g.fields)
      .filter((f: RecordValue) => f.required && !f.latest)
      .map((f: RecordValue) => f.id),
  );
  return issues.sort(
    (a, b) => Number(missing.has(b.id)) - Number(missing.has(a.id)),
  );
}

export function workflowGroupProgress(group: RecordValue) {
  const required = group.fields.filter((f: RecordValue) => f.required);
  const fields = required.length ? required : group.fields;
  const done = fields.filter(
    (f: RecordValue) => f.latest?.scan_status === "clean",
  ).length;
  return {
    done,
    total: fields.length,
    complete:
      fields.length > 0 &&
      done === fields.length &&
      workflowIssues({ groups: [group] }).length === 0,
  };
}
