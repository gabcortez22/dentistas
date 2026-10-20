const zone = "America/Lima";
export const formatDateTime = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: zone,
  }).format(d);
export const formatTime = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  }).format(d);
export const formatDay = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
  }).format(d);
