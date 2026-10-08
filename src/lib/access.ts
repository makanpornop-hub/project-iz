import { headers } from "next/headers";
import type { PoolClient } from "pg";
import { db } from "./db";
import { getAuth } from "./auth";
import type { Permission } from "./domain";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
};
export async function actorFor(id: string): Promise<Actor> {
  const { rows } = await db.query(
    "SELECT u.id,u.name,u.email,s.role_id role,s.active,coalesce(array_agg(rp.permission_id) FILTER(WHERE rp.permission_id IS NOT NULL),'{}') permissions FROM \"user\" u JOIN staff s ON s.user_id=u.id LEFT JOIN role_permissions rp ON rp.role_id=s.role_id WHERE u.id=$1 GROUP BY u.id,s.role_id,s.active",
    [id],
  );
  if (!rows[0]?.active) throw new AppError(401, "Войдите в систему");
  return rows[0];
}
export async function currentActor() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) throw new AppError(401, "Войдите в систему");
  return actorFor(session.user.id);
}
export function requirePermission(a: Actor, p: Permission) {
  if (!a.permissions.includes(p)) throw new AppError(403, "Недостаточно прав");
}
export function scopeSql(a: Actor, alias = "c", param = 1) {
  return a.permissions.includes("can_view_all_cases")
    ? "TRUE"
    : `(${alias}.responsible_id=$${param} OR ${alias}.escalation_id=$${param} OR EXISTS(SELECT 1 FROM tasks access_task WHERE access_task.case_id=${alias}.id AND access_task.status<>'Completed' AND (access_task.responsible_id=$${param} OR access_task.escalation_id=$${param})))`;
}
export async function requireCase(
  a: Actor,
  id: string,
  p: Permission = "can_view_cases",
  c: Pick<PoolClient, "query"> = db,
) {
  requirePermission(a, "can_view_cases");
  requirePermission(a, p);
  const { rows } = await c.query(
    `SELECT c.* FROM cases c WHERE c.id=$2 AND ($1::text IS NOT NULL) AND ${scopeSql(a)}`,
    [a.id, id],
  );
  if (!rows[0]) throw new AppError(404, "Дело не найдено или недоступно");
  return rows[0];
}
export async function audit(
  c: Pick<PoolClient, "query">,
  a: Actor | null,
  action: string,
  entity: string,
  id: string,
  caseId: string | null = null,
  detail: unknown = {},
  source = "website",
) {
  await c.query(
    "INSERT INTO audit_logs(user_id,action,entity,entity_id,case_id,detail,source) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [a?.id ?? null, action, entity, id, caseId, JSON.stringify(detail), source],
  );
}
export function checkOrigin(req: Request) {
  const expected = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
  ).origin;
  if (req.headers.get("origin") !== expected)
    throw new AppError(403, "Недопустимый источник запроса");
}
export async function limit(key: string, max = 80) {
  const { rows } = await db.query(
    "INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.hits+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+interval '1 minute' ELSE rate_limits.reset_at END RETURNING hits",
    [key],
  );
  if (rows[0].hits > max)
    throw new AppError(429, "Слишком много запросов. Попробуйте через минуту.");
}
