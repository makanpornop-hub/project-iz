"use client";
import Link from "next/link";
import { useT } from "./language";
import { labels } from "@/lib/domain";
import { ChevronLeft, ChevronRight } from "lucide-react";
type Row = Record<string, any>;
export default function DashboardCases({
  rows,
  page,
  onPage,
  dt,
}: {
  rows: Row[];
  page: number;
  onPage: (p: number) => void;
  dt: (v: string) => string;
}) {
  const tr = useT(),
    total = Number(rows[0]?.total || 0);
  if (!rows.length)
    return (
      <div className="empty">
        <p>{tr("Дел с выбранным статусом нет")}</p>
      </div>
    );
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Клиент / дело")}</th>
              <th>{tr("Виза")}</th>
              <th>{tr("Статус")}</th>
              <th>{tr("Ответственный")}</th>
              <th>{tr("Срок")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="row-title" href={"/cases/" + c.id}>
                    {c.name}
                  </Link>
                  <small>CASE-{String(c.number).padStart(3, "0")}</small>
                </td>
                <td>
                  {c.country}
                  <small>{c.visa_type}</small>
                </td>
                <td>
                  <span
                    className={
                      "badge b-" + c.status.toLowerCase().replaceAll(" ", "-")
                    }
                  >
                    {tr(labels[c.status])}
                  </span>
                </td>
                <td>{c.responsible_name}</td>
                <td>{tr(dt(c.deadline))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {tr("Всего дел: ")}
          {total}
        </span>
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          aria-label={tr("Предыдущая страница")}
        >
          <ChevronLeft size={16} />
        </button>
        <span>{page}</span>
        <button
          type="button"
          disabled={page * 20 >= total}
          onClick={() => onPage(page + 1)}
          aria-label={tr("Следующая страница")}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </>
  );
}
