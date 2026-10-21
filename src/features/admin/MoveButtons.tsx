import { useEffect, useRef } from 'react'

type Props = {
  /** Used in the accessible names: "Move Badminton 1 up". */
  label: string
  /** The item's current position; when it changes after a move, focus returns to the button that was pressed. */
  position: number
  canMoveUp: boolean
  canMoveDown: boolean
  disabled?: boolean
  onMove: (direction: -1 | 1) => void
}

/** Up and down buttons for reordering a list item (T9.4). Disabled at the edges. */
export function MoveButtons({ label, position, canMoveUp, canMoveDown, disabled = false, onMove }: Props) {
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)
  const pressed = useRef<-1 | 1 | null>(null)

  // Reordering moves this row in the DOM, which drops keyboard focus. Put it back on the button that was
  // pressed, or on the other one if the item reached an edge.
  useEffect(() => {
    if (pressed.current === null) return
    const wanted = pressed.current === -1 ? up.current : down.current
    const other = pressed.current === -1 ? down.current : up.current
    pressed.current = null
    if (wanted && !wanted.disabled) wanted.focus()
    else other?.focus()
  }, [position])

  function move(direction: -1 | 1) {
    pressed.current = direction
    onMove(direction)
  }

  return (
    <span className="move-buttons">
      <button ref={up} type="button" className="btn btn-outline icon-btn" aria-label={`Move ${label} up`}
        disabled={disabled || !canMoveUp} onClick={() => move(-1)}>
        <span aria-hidden="true">↑</span>
      </button>
      <button ref={down} type="button" className="btn btn-outline icon-btn" aria-label={`Move ${label} down`}
        disabled={disabled || !canMoveDown} onClick={() => move(1)}>
        <span aria-hidden="true">↓</span>
      </button>
    </span>
  )
}
