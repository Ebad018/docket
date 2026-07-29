export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "4 min ago", "Yesterday", "12 Mar" — the coarse column in the listing. */
export const formatRelative = (iso: string, now = Date.now()): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const elapsed = now - then;

  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }

  const thenDate = new Date(then);
  const nowDate = new Date(now);
  const midnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const days = Math.floor((midnight.getTime() - thenDate.getTime()) / DAY) + 1;

  if (days <= 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (thenDate.getFullYear() === nowDate.getFullYear()) {
    return thenDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  return thenDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

/** The exact stamp beneath the relative one — this is a record, after all. */
export const formatClock = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export const formatFullStamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/** Windows paths get long; keep the drive and the last two folders. */
export const shortenFolder = (folder: string, maxSegments = 3): string => {
  const segments = folder.split(/[\\/]/).filter(Boolean);
  if (segments.length <= maxSegments + 1) return folder;
  const head = segments[0];
  const tail = segments.slice(-maxSegments);
  return [head, '…', ...tail].join('\\');
};

export const columnLabel = (index: number): string => {
  let label = '';
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

/** Case-insensitive subsequence match, the behaviour a command palette needs. */
export const fuzzyMatch = (haystack: string, needle: string): boolean => {
  if (!needle) return true;
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();
  if (target.includes(query)) return true;
  let cursor = 0;
  for (const character of query) {
    cursor = target.indexOf(character, cursor);
    if (cursor === -1) return false;
    cursor += 1;
  }
  return true;
};
