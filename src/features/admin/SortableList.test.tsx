import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { menuMove, openMoveMenu } from '../../test/reorder'
import { SortableList } from './SortableList'

const START = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Bravo' }, { id: 'c', label: 'Charlie' }]

function Harness({ onReorder = () => {}, disabled = false }: { onReorder?: (ids: string[]) => void; disabled?: boolean }) {
  const [items, setItems] = useState(START)
  return (
    <SortableList label="Things" items={items} disabled={disabled}
      onReorder={(ids) => { onReorder(ids); setItems(ids.map((id) => START.find((i) => i.id === id)!)) }}
      renderItem={(item) => <span className="row-name">{item.label}</span>} />
  )
}

const names = () => within(screen.getByRole('list', { name: 'Things' })).getAllByRole('listitem').map((li) => li.textContent)

describe('SortableList', () => {
  it('gives every item one handle named after it, and no arrow buttons', () => {
    render(<Harness />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Reorder Bravo' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /up$/ })).toBeNull()
  })

  it('opens a move menu on a tap (no drag needed), with the edges disabled', async () => {
    render(<Harness />)
    const menu = await openMoveMenu('Alpha')
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveAttribute('aria-expanded', 'true')
    expect(menu.getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Move to top' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Move down' })).toHaveFocus() // the first move that can happen
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Move Alpha' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveFocus()
  })

  it('moves with the menu, reports the whole order, and keeps focus on the moved handle', async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    await menuMove('Charlie', 'Move to top')
    expect(onReorder).toHaveBeenLastCalledWith(['c', 'a', 'b'])
    expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(screen.getByRole('button', { name: 'Reorder Charlie' })).toHaveFocus()
    await menuMove('Alpha', 'Move to bottom')
    expect(onReorder).toHaveBeenLastCalledWith(['c', 'b', 'a'])
    await menuMove('Alpha', 'Move up')
    expect(onReorder).toHaveBeenLastCalledWith(['c', 'a', 'b'])
  })

  it('opens the menu with Enter, for keyboard users who prefer it', async () => {
    render(<Harness />)
    screen.getByRole('button', { name: 'Reorder Bravo' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('group', { name: 'Move Bravo' })).toBeInTheDocument()
  })

  it('picks up with Space, moves with the arrow keys (shown at once, saved on the drop) and drops with Space', async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    const handle = screen.getByRole('button', { name: 'Reorder Alpha' })
    handle.focus()
    await userEvent.keyboard('[Space]')
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Picked up Alpha, in position 1 of 3\./)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Move Alpha' })).toBeNull() // Space doesn't open the menu
    await userEvent.keyboard('[ArrowDown]')
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    expect(screen.getByText('Alpha, position 2 of 3.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveFocus()
    await userEvent.keyboard('[ArrowDown][ArrowDown]') // stops at the bottom
    expect(names()).toEqual(['Bravo', 'Charlie', 'Alpha'])
    expect(onReorder).not.toHaveBeenCalled() // nothing is saved until the drop
    await userEvent.keyboard('[Space]')
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(['b', 'c', 'a'])
    expect(screen.getByText('Dropped Alpha at position 3 of 3.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('puts the item back on Escape without saving', async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    screen.getByRole('button', { name: 'Reorder Charlie' }).focus()
    await userEvent.keyboard('[Space][ArrowUp][ArrowUp]')
    expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo'])
    await userEvent.keyboard('[Escape]')
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(screen.getByText('Cancelled. Charlie is back in position 3 of 3.')).toBeInTheDocument()
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('drops a held item with Enter too', async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    screen.getByRole('button', { name: 'Reorder Bravo' }).focus()
    await userEvent.keyboard('[Space][ArrowUp]{Enter}')
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(['b', 'a', 'c'])
    expect(screen.queryByRole('group', { name: 'Move Bravo' })).toBeNull() // Enter dropped; it didn't open the menu
  })

  it('cancels a hold when focus leaves the handle', async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    screen.getByRole('button', { name: 'Reorder Alpha' }).focus()
    await userEvent.keyboard('[Space][ArrowDown]')
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    await userEvent.tab()
    await vi.waitFor(() => expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie']))
    expect(screen.getByText('Cancelled. Alpha is back in position 1 of 3.')).toBeInTheDocument()
    expect(onReorder).not.toHaveBeenCalled()
  })

  it("ends a hold when another item's menu moves it, acting on the saved order", async () => {
    const onReorder = vi.fn()
    render(<Harness onReorder={onReorder} />)
    screen.getByRole('button', { name: 'Reorder Alpha' }).focus()
    await userEvent.keyboard('[Space][ArrowDown]')
    await menuMove('Charlie', 'Move to top')
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(['c', 'a', 'b'])
    expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('cannot be reordered while disabled', () => {
    render(<Harness disabled />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })
})
