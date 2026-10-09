export function notificationId(timers, now = Date.now()) {
  const existing = new Set(timers.map((timer) => timer.notificationId));
  let id = now % 2147483647 || 1;
  while (existing.has(id)) id = (id % 2147483646) + 1;
  return id;
}

export function notificationChanges(timers, pending, now = Date.now()) {
  const wanted = timers.filter(
    (timer) => timer.pausedMs === null && timer.endAt > now,
  );
  const owned = pending.filter((item) => item.extra?.kooksTimer === true);
  const same = (notification, timer) =>
    notification.id === timer.notificationId &&
    notification.extra?.deadline === timer.endAt;
  return {
    cancel: owned
      .filter((item) => !wanted.some((timer) => same(item, timer)))
      .map((item) => ({ id: item.id })),
    schedule: wanted
      .filter((timer) => !owned.some((item) => same(item, timer)))
      .map((timer) => ({
        id: timer.notificationId,
        title: "Kooks · Timer ready",
        body: timer.label,
        schedule: { at: new Date(timer.endAt), allowWhileIdle: true },
        channelId: "kooks-timers",
        extra: { kooksTimer: true, timerId: timer.id, deadline: timer.endAt },
      })),
  };
}
