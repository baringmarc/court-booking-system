import { ConsoleGuard } from './ConsoleGuard'
import { ConsolePage } from './ConsolePage'

export function ConsoleApp() {
  return (
    <ConsoleGuard>
      <ConsolePage />
    </ConsoleGuard>
  )
}
