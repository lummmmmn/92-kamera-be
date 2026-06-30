export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + (days < 1 ? 0 : Math.ceil(days)));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getDateRange(startDate: string, days: number): string[] {
  if (days < 1) return [startDate];

  const range: string[] = [];
  for (let i = 0; i < Math.ceil(days); i += 1) {
    range.push(dateAddDays(startDate, i));
  }
  return range;
}

export function isDateInOrder(dateStr: string, order: { date?: unknown; days?: unknown }): boolean {
  if (typeof order.date !== "string") return false;
  const days = Number(order.days);
  if (!Number.isFinite(days) || days <= 0) return false;

  const endDate = dateAddDays(order.date, days);
  if (days < 1) return dateStr >= order.date && dateStr <= endDate;
  return dateStr >= order.date && dateStr < endDate;
}

export function getOrderSession(order: { session?: unknown; shift?: unknown }): "morning" | "afternoon" | "full" {
  if (order.session === "morning" || order.session === "afternoon" || order.session === "full") {
    return order.session;
  }

  if (order.shift === "morning" || order.shift === "afternoon") {
    return order.shift;
  }

  return "full";
}

export function sessionsConflict(orderSession: string, targetSession: string): boolean {
  if (orderSession === "full" || targetSession === "full") return true;
  return orderSession === targetSession;
}
