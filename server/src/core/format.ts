const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock timestamp, e.g. "2026-10-12 15.04.05" (with `sep` between time parts). */
export function localStamp(date = new Date(), sep = ':'): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join(sep);
  return `${day} ${time}`;
}
