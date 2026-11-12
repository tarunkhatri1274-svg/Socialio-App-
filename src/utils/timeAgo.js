const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} ago`;

export function timeAgo(input) {
  if (!input) return "";
  const date = new Date(input);
  const t = date.getTime();
  if (Number.isNaN(t)) return "";

  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec} sec ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return plural(hrs, "hour");

  const days = Math.floor(hrs / 24);
  if (days < 7) return plural(days, "day");

  if (days < 30) return plural(Math.floor(days / 7), "week");

  if (days < 365) return plural(Math.min(11, Math.floor(days / 30)), "month");

  // 1 year or older -> exact date, e.g. 23-June-2026
  return `${date.getDate()}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

export default timeAgo;