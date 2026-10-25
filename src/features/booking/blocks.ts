// Merged blocks on the slot grids (T10.5, RESEARCH M10). Cells that hold the same booking, open play session or
// blackout become one table cell spanning those rows, and neighbouring courts with exactly the same run share it.

/** A cell to render: its spans, and the rows and columns it covers. */
export type BlockCell = { kind: 'cell'; rowSpan: number; colSpan: number; firstRow: number; lastRow: number; columns: number[] }
/** A cell covered by a span from above or the left: render nothing. */
export type CoveredCell = { kind: 'covered' }
export type GridCell = BlockCell | CoveredCell

type Run = { col: number; first: number; last: number; key: string }

/**
 * Lays out a rows × columns grid. `keyAt(row, col)` is the block a cell belongs to, or null for a cell that stands
 * alone (free, past, empty). Rows are consecutive hours, so a key repeating on the next row continues the block;
 * a block that began before the first row simply starts there. Runs on neighbouring columns merge only when they
 * have the same key and the same rows.
 */
export function groupBlocks(rows: number, cols: number, keyAt: (row: number, col: number) => string | null): GridCell[][] {
  const runs: Run[] = []
  for (let col = 0; col < cols; col++) {
    let row = 0
    while (row < rows) {
      const key = keyAt(row, col)
      let last = row
      if (key !== null) while (last + 1 < rows && keyAt(last + 1, col) === key) last++
      if (key !== null) runs.push({ col, first: row, last, key })
      row = last + 1
    }
  }

  const grid: GridCell[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col): GridCell => ({ kind: 'cell', rowSpan: 1, colSpan: 1, firstRow: row, lastRow: row, columns: [col] })))

  const byStart = new Map(runs.map((r) => [`${r.col}:${r.first}`, r]))
  const used = new Set<Run>()
  for (const run of runs) {
    if (used.has(run)) continue
    const columns = [run.col]
    let next = byStart.get(`${run.col + 1}:${run.first}`)
    while (next && next.key === run.key && next.last === run.last && !used.has(next)) {
      used.add(next)
      columns.push(next.col)
      next = byStart.get(`${next.col + 1}:${run.first}`)
    }
    used.add(run)
    for (let row = run.first; row <= run.last; row++) for (const col of columns) grid[row][col] = { kind: 'covered' }
    grid[run.first][run.col] = {
      kind: 'cell', rowSpan: run.last - run.first + 1, colSpan: columns.length, firstRow: run.first, lastRow: run.last, columns,
    }
  }
  return grid
}

/** "Badminton 1", "Badminton 1 and Badminton 2", "Badminton 1, Badminton 2 and Badminton 3". */
export function joinNames(names: string[]) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
