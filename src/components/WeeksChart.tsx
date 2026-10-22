import { dfmt, nf } from "@/lib/format";

export default function WeeksChart({ weeks }: { weeks: { week_start: string; watch_hours: number | null }[] }) {
  const W = 640, H = 190, L = 44, R = 12, T = 14, B = 28, data = weeks.slice(-12);
  const max = Math.max(1, ...data.map((w) => w.watch_hours ?? 0));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= max) ?? max;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice), bw = (W - L - R) / Math.max(data.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Godziny oglądania w ostatnich tygodniach">
      {[0, 1, 2, 3, 4].map((i) => {
        const v = (nice * i) / 4;
        return (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--f-mono)">{nf(nice < 10 ? 1 : 0).format(v)}</text>
          </g>
        );
      })}
      {data.map((w, i) => {
        const v = w.watch_hours ?? 0, x = L + i * bw + bw * 0.18, last = i === data.length - 1;
        return (
          <g key={w.week_start}>
            <rect x={x} y={y(v)} width={bw * 0.64} height={Math.max(0, y(0) - y(v))} rx={3} fill={last ? "var(--ember)" : "var(--accent)"} opacity={last ? 1 : 0.75} />
            {(data.length <= 8 || (data.length - 1 - i) % 2 === 0) && (
              <text x={x + bw * 0.32} y={H - 9} textAnchor="middle" fontSize={11} fill="var(--muted)">{dfmt(w.week_start)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
