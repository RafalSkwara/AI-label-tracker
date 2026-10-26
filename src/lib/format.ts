export const nf = (d = 0) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const pln = (n: number) => nf(0).format(Math.round(n)) + " zł";
export const dfmt = (d?: string | null) =>
  d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "";
export const dmy = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
export const daysTo = (d: string) => Math.round((Date.parse(d.slice(0, 10)) - Date.parse(today())) / 864e5);
export const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const inDays = (n: number) => iso(new Date(Date.now() + n * 864e5));
export const monday = (s: string) => {
  const d = new Date(s.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
};
export const num = (v: unknown): number | null =>
  v === "" || v == null || isNaN(Number(v)) ? null : Number(v);

/** Timestamp (ISO, UTC) shown in Warsaw local time, e.g. "26.10, 07:05" */
export const localDateTime = (t: string) =>
  new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
