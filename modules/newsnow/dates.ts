// The start of a day in a zone, as an instant. The Product Hunt adapter asks for the day that began
// in Los Angeles, and the container's own zone is not that one.

function zoneParts(timeZone: string, at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { y: value("year"), mo: value("month"), d: value("day"), h: value("hour") % 24, mi: value("minute"), s: value("second") };
}

/** The instant the day that is running in that zone began. */
export function startOfDayIn(timeZone: string, now: Date): Date {
  const day = zoneParts(timeZone, now);
  const midnight = Date.UTC(day.y, day.mo - 1, day.d);
  // The zone's offset at that moment, read twice: the offset at midnight and the offset at the
  // instant it names can differ on the day a zone changes its clocks.
  let at = midnight;
  for (let pass = 0; pass < 2; pass++) {
    const wall = zoneParts(timeZone, new Date(at));
    const asUtc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
    at = midnight - (asUtc - midnight);
  }
  return new Date(at);
}
