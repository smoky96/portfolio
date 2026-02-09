export const DISPLAY_DIGITS = 3;

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatDecimal(value: string | number | null | undefined, digits = DISPLAY_DIGITS): string {
  const num = toNumber(value);
  if (num === null) {
    return "-";
  }
  return num.toFixed(digits);
}

export function formatPercent(value: string | number | null | undefined, digits = DISPLAY_DIGITS): string {
  return `${formatDecimal(value, digits)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function sumDecimals(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((acc, current) => {
    const value = toNumber(current);
    return acc + (value ?? 0);
  }, 0);
}

export function isHundred(value: number, tolerance = 0.0001): boolean {
  return Math.abs(value - 100) <= tolerance;
}
