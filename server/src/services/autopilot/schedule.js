// Works out run times for Autopilot in the admin's time zone.

// Minutes the time zone is ahead of UTC at a given instant.
export function tzOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Local calendar date (y, m, d) in the time zone for an instant.
function localDate(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  );
  return [p.year, p.month, p.day];
}

// UTC instant for a local wall-clock time in the time zone.
function zonedTime(y, m, d, minutes, timeZone) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

// Daily slots: startTime, then every 24/postsPerDay hours.
export function slotMinutes(startTime, postsPerDay) {
  const [h, m] = String(startTime || '06:00').split(':').map(Number);
  const start = (h || 0) * 60 + (m || 0);
  const step = 1440 / Math.max(1, postsPerDay);
  return Array.from({ length: postsPerDay }, (_, k) => Math.round(start + k * step) % 1440).sort((a, b) => a - b);
}

// The first slot strictly after `now`.
export function nextRunTime(now, { startTime, postsPerDay, timezone }) {
  const tz = isValidTimeZone(timezone) ? timezone : 'UTC';
  const slots = slotMinutes(startTime, postsPerDay);
  const [y, mo, d] = localDate(now, tz);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const base = new Date(Date.UTC(y, mo - 1, d + dayOffset));
    for (const min of slots) {
      const t = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), min, tz);
      if (t.getTime() > now.getTime() + 1000) return t;
    }
  }
  return new Date(now.getTime() + 86400000);
}

// The UTC instant of local midnight (start of today) in the time zone.
export function localDayStart(now, timezone) {
  const tz = isValidTimeZone(timezone) ? timezone : 'UTC';
  const [y, m, d] = localDate(now, tz);
  return zonedTime(y, m, d, 0, tz);
}

// Which of today's posts are evergreen guides: spread evenly through the day
// (with 4 posts and 2 evergreen: trending, evergreen, trending, evergreen).
export function slotKind(index, postsPerDay, evergreenPerDay) {
  const n = Math.max(1, postsPerDay);
  const e = Math.min(Math.max(0, evergreenPerDay || 0), n);
  const i = ((index % n) + n) % n;
  return Math.floor(((i + 1) * e) / n) > Math.floor((i * e) / n) ? 'evergreen' : 'trending';
}
