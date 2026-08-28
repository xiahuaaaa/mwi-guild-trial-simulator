import { shanghaiDayKey } from "./group-daily-quota.ts";

/** API ISO timestamp → `YYYY-MM-DD HH:mm:ss 北京时间`. */
export function formatBeijingTimestamp(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return raw == null ? "" : String(raw);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${shanghaiDayKey(date)} ${time} 北京时间`;
}
