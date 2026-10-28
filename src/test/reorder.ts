// Drives SortableList's tap menu (T11.5a) in component tests: open an item's ☰ handle, then pick a move.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

export type Move = 'Move up' | 'Move down' | 'Move to top' | 'Move to bottom'

/** Opens the item's menu and returns its move buttons. */
export async function openMoveMenu(label: string) {
  const handle = await screen.findByRole('button', { name: `Reorder ${label}` })
  if (handle.getAttribute('aria-expanded') !== 'true') await userEvent.click(handle)
  return within(screen.getByRole('group', { name: `Move ${label}` }))
}

/** Opens the item's menu and picks `move`. */
export async function menuMove(label: string, move: Move) {
  const menu = await openMoveMenu(label)
  await userEvent.click(menu.getByRole('button', { name: move }))
}
