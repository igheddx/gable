import { useEffect, useState } from 'react';
import { todayIso } from '../../shared/dates';

/** Today's local calendar date, refreshed at local midnight so "Held to date" never goes stale. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const t = setTimeout(() => setToday(todayIso()), next.getTime() - now.getTime());
    return () => clearTimeout(t);
  }, [today]);
  return today;
}
