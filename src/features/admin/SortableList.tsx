import {
  closestCenter, DndContext, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Menu } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type SortableItem = { id: string; label: string }

type Props<T extends SortableItem> = {
  items: T[]
  /** The whole new order, as ids. Called on a drop or a menu move that changes something. */
  onReorder: (ids: string[]) => void
  renderItem: (item: T, index: number) => ReactNode
  /** "grid" for photo tiles (drag in both directions); "list" otherwise. */
  layout?: 'list' | 'grid'
  /** The list's accessible name, e.g. "Badminton courts". */
  label: string
  disabled?: boolean
  className?: string
}

/** A keyboard pick-up in progress: the item and the order shown while it moves (saved only on the drop). */
type Grab = { id: string; order: string[]; from: number }

const INSTRUCTIONS = 'To reorder, press Space to pick it up, the arrow keys to move it, and Space or Enter to drop it. Escape cancels. Or press Enter for a menu.'

/**
 * A list reordered with one ☰ handle per item (T11.5a, replacing the up and down arrows). Drag the handle with a
 * mouse or a finger (dnd-kit); tap it (or press Enter) for Move up, Move down, Move to top and Move to bottom
 * (WCAG 2.5.7, a way without dragging); or press Space on it, the arrow keys, then Space to drop (Escape cancels).
 * The keyboard path is our own: dnd-kit's keyboard sensor didn't move items in Chrome (found in T11.5a's e2e).
 */
export function SortableList<T extends SortableItem>({ items, onReorder, renderItem, layout = 'list', label, disabled = false, className = '' }: Props<T>) {
  // A short move starts a drag, so a tap stays a click (it opens the menu).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [grab, setGrab] = useState<Grab | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // The hold as of the last render, for the blur check (it runs after the event that caused it).
  const grabRef = useRef<Grab | null>(null)
  useEffect(() => { grabRef.current = grab })
  const ids = items.map((i) => i.id)
  const shownIds = grab?.order ?? ids
  const shown = shownIds.flatMap((id) => items.filter((i) => i.id === id))
  const labelOf = (id: UniqueIdentifier) => items.find((i) => i.id === id)?.label ?? 'item'
  const positionIn = (list: string[], id: UniqueIdentifier) => `position ${list.indexOf(String(id)) + 1} of ${list.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}, in ${positionIn(ids, active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)} is over ${positionIn(ids, over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${labelOf(active.id)} at ${positionIn(ids, over.id)}.` : `Dropped ${labelOf(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${labelOf(active.id)} is back in ${positionIn(ids, active.id)}.`,
  }

  // A move changes the row's place in the DOM, which drops focus: give it back to the moved row's handle.
  const refocus = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const order = shownIds.join(',')
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    const handles = listRef.current?.querySelectorAll<HTMLElement>('[data-handle-for]') ?? []
    Array.from(handles).find((h) => h.dataset.handleFor === id)?.focus()
  }, [order])

  /** Ends a keyboard hold without saving: the saved order shows again. */
  function cancelGrab(held: Grab) {
    setGrab(null)
    setAnnouncement(`Cancelled. ${labelOf(held.id)} is back in position ${held.from + 1} of ${ids.length}.`)
  }

  // Leaving the held handle (Tab, a click elsewhere) cancels the hold. A keyboard move re-renders the row and
  // briefly drops focus before it's given back, so check once that has settled.
  function handleBlur(id: string) {
    setTimeout(() => {
      const held = grabRef.current
      const active = document.activeElement
      if (held?.id === id && !(active instanceof HTMLElement && active.dataset.handleFor === id)) cancelGrab(held)
    }, 0)
  }

  function move(from: number, to: number) {
    if (grab) setGrab(null) // a menu move ends any keyboard hold; it acts on the saved order
    if (from === to || to < 0 || to >= ids.length) return
    refocus.current = ids[from]
    onReorder(arrayMove(ids, from, to))
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  /** The keyboard path on a handle. Returns true when it used the key. */
  function handleKey(id: string, e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return false
    const drop = (held: Grab) => {
      setGrab(null)
      setAnnouncement(`Dropped ${labelOf(id)} at ${positionIn(held.order, id)}.`)
      if (held.order.join(',') !== ids.join(',')) onReorder(held.order)
    }
    // Enter drops a held item; otherwise it's left to the button, which opens the menu.
    if (e.key === 'Enter' && grab?.id === id) {
      drop(grab)
      return true
    }
    if (e.code === 'Space') {
      if (grab?.id === id) {
        drop(grab)
      } else {
        // Picking up another item puts any held one back first.
        setGrab({ id, order: ids, from: ids.indexOf(id) })
        setAnnouncement(`Picked up ${labelOf(id)}, in ${positionIn(ids, id)}. Use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.`)
      }
      return true
    }
    if (!grab || grab.id !== id) return false
    const step = ({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 } as Record<string, number>)[e.code]
    if (step) {
      const at = grab.order.indexOf(id)
      const to = at + step
      if (to >= 0 && to < grab.order.length) {
        const next = arrayMove(grab.order, at, to)
        refocus.current = id
        setGrab({ ...grab, order: next })
        setAnnouncement(`${labelOf(id)}, ${positionIn(next, id)}.`)
      }
      return true
    }
    if (e.code === 'Escape') {
      cancelGrab(grab)
      return true
    }
    return false
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
      onDragStart={() => { if (grab) setGrab(null) }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}>
      <SortableContext items={shownIds} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy} disabled={disabled}>
        <ul ref={listRef} className={`sortable sortable-${layout} ${className}`} aria-label={label}>
          {shown.map((item, i) => (
            <Row key={item.id} item={item} index={i} count={shown.length} disabled={disabled} grabbed={grab?.id === item.id}
              onMove={(to) => move(i, to)} onKey={(e) => handleKey(item.id, e)} onBlur={() => handleBlur(item.id)}>
              {renderItem(item, i)}
            </Row>
          ))}
        </ul>
      </SortableContext>
      <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true">{announcement}</p>
    </DndContext>
  )
}

type RowProps = {
  item: SortableItem
  index: number
  count: number
  disabled: boolean
  grabbed: boolean
  onMove: (to: number) => void
  /** The keyboard path; true when it used the key. */
  onKey: (e: KeyboardEvent<HTMLButtonElement>) => boolean
  onBlur: () => void
  children: ReactNode
}

function Row({ item, index, count, disabled, grabbed, onMove, onKey, onBlur, children }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Space drives the keyboard path; a browser also turns it into a click on key up, which must not open the menu.
  const spacePressed = useRef(false)

  // The menu closes on Escape or a tap outside it, and gives focus back to the handle on Escape.
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== handleRef.current) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  function choose(to: number) {
    setMenuOpen(false)
    onMove(to)
  }

  const moves = [
    { text: 'Move up', to: index - 1, off: index === 0 },
    { text: 'Move down', to: index + 1, off: index === count - 1 },
    { text: 'Move to top', to: 0, off: index === 0 },
    { text: 'Move to bottom', to: count - 1, off: index === count - 1 },
  ]

  return (
    <li ref={setNodeRef} className={`sortable-item${isDragging || grabbed ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      {children}
      <span className="sortable-handle-wrap">
        <button
          type="button"
          {...attributes}
          {...listeners}
          ref={(el) => { setActivatorNodeRef(el); handleRef.current = el }}
          data-handle-for={item.id}
          className="btn btn-outline icon-btn drag-handle"
          aria-label={`Reorder ${item.label}`}
          aria-pressed={grabbed}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.code === 'Space') spacePressed.current = true
            if (onKey(e)) e.preventDefault()
          }}
          onClick={() => {
            if (spacePressed.current) { spacePressed.current = false; return }
            setMenuOpen((o) => !o)
          }}
          onBlur={onBlur}
        >
          <Menu aria-hidden="true" className="social-icon" />
        </button>
        {menuOpen && (
          <div ref={menuRef} id={menuId} className="sortable-menu" role="group" aria-label={`Move ${item.label}`}
            onKeyDown={(e) => { if (e.key === 'Escape') { setMenuOpen(false); handleRef.current?.focus() } }}>
            {moves.map((m) => (
              <button key={m.text} type="button" className="btn btn-ghost btn-small" disabled={m.off} onClick={() => choose(m.to)}>
                {m.text}
              </button>
            ))}
          </div>
        )}
      </span>
    </li>
  )
}
