const activityClockSkewMs = 5 * 60 * 1000;

export function isActivityTimeAllowed(value: Date, now = Date.now()) {
  return Number.isFinite(value.getTime()) && value.getTime() <= now + activityClockSkewMs;
}
