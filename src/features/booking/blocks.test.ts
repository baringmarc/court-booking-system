import { describe, expect, it } from 'vitest'
import { groupBlocks, joinNames, type GridCell } from './blocks'

/** Builds keyAt from rows of strings: one character per column, '.' for no key. */
const keys = (rows: string[]) => (row: number, col: number) => (rows[row][col] === '.' ? null : rows[row][col])

/** A compact picture of the layout: "2x1" for a cell spanning 2 rows and 1 column, "-" for a covered one. */
const picture = (grid: GridCell[][]) =>
  grid.map((row) => row.map((c) => (c.kind === 'covered' ? '-' : `${c.rowSpan}x${c.colSpan}`)).join(' '))

describe('groupBlocks', () => {
  it('leaves cells without a key alone', () => {
    expect(picture(groupBlocks(2, 2, keys(['..', '..'])))).toEqual(['1x1 1x1', '1x1 1x1'])
  })

  it('merges a key down its consecutive rows', () => {
    const grid = groupBlocks(4, 1, keys(['.', 'a', 'a', '.']))
    expect(picture(grid)).toEqual(['1x1', '2x1', '-', '1x1'])
    expect(grid[1][0]).toMatchObject({ firstRow: 1, lastRow: 2, columns: [0] })
  })

  it('splits a key at a gap, and keeps different keys apart', () => {
    expect(picture(groupBlocks(5, 1, keys(['a', '.', 'a', 'b', 'b'])))).toEqual(['1x1', '1x1', '1x1', '2x1', '-'])
  })

  it('starts a block at the first row when it began before it (an overnight row set)', () => {
    expect(picture(groupBlocks(3, 1, keys(['a', 'a', '.'])))).toEqual(['2x1', '-', '1x1'])
  })

  it('runs a block to the last row, after midnight included', () => {
    expect(picture(groupBlocks(3, 1, keys(['.', 'n', 'n'])))).toEqual(['1x1', '2x1', '-'])
  })

  it('merges neighbouring courts with the same key and the same rows', () => {
    const grid = groupBlocks(3, 3, keys(['xx.', 'xx.', '...']))
    expect(picture(grid)).toEqual(['2x2 - 1x1', '- - 1x1', '1x1 1x1 1x1'])
    expect(grid[0][0]).toMatchObject({ columns: [0, 1] })
  })

  it('merges across three courts', () => {
    expect(picture(groupBlocks(1, 3, keys(['xxx'])))).toEqual(['1x3 - -'])
  })

  it('does not merge courts whose runs differ in length', () => {
    expect(picture(groupBlocks(2, 2, keys(['xx', 'x.'])))).toEqual(['2x1 1x1', '- 1x1'])
  })

  it('does not merge courts that are not next to each other', () => {
    expect(picture(groupBlocks(1, 3, keys(['x.x'])))).toEqual(['1x1 1x1 1x1'])
  })

  it('does not merge different keys on neighbouring courts', () => {
    expect(picture(groupBlocks(2, 2, keys(['ab', 'ab'])))).toEqual(['2x1 2x1', '- -'])
  })

  it('handles an empty grid', () => {
    expect(groupBlocks(0, 2, () => null)).toEqual([])
  })
})

describe('joinNames', () => {
  it('lists courts in words', () => {
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})
