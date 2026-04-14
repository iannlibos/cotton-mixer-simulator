export type SortGetter<T> = (row: T) => string | number;

export type SortColumn<T> = { get: SortGetter<T>; numeric?: boolean };

/** Stable sort: toggling asc/desc; strings use pt-BR locale with numeric awareness. */
export function sortRows<T>(
  rows: readonly T[],
  sortKey: string | null,
  asc: boolean,
  columns: Record<string, SortColumn<T>>
): T[] {
  if (!sortKey) return [...rows];
  const col = columns[sortKey];
  if (!col) return [...rows];
  const dir = asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = col.get(a);
    const vb = col.get(b);
    if (col.numeric) {
      const na = typeof va === "number" ? va : Number(va);
      const nb = typeof vb === "number" ? vb : Number(vb);
      const aNum = Number.isFinite(na) ? na : 0;
      const bNum = Number.isFinite(nb) ? nb : 0;
      if (aNum === bNum) return 0;
      return aNum < bNum ? -dir : dir;
    }
    const sa = String(va ?? "").toLowerCase();
    const sb = String(vb ?? "").toLowerCase();
    const c = sa.localeCompare(sb, "pt-BR", { numeric: true, sensitivity: "base" });
    return dir * c;
  });
}

export function nextSortState(
  prev: { key: string; asc: boolean } | null,
  key: string
): { key: string; asc: boolean } {
  if (prev?.key === key) return { key, asc: !prev.asc };
  return { key, asc: true };
}
