import { Pager as SharedPager } from '../../components/Pager'
import { CONSOLE_PAGE_SIZE } from './api'

/** Previous/Next over a console list (T17.19), at the console page size. */
export function Pager(props: { label: string; page: number; total: number; onPage: (page: number) => void }) {
  return <SharedPager {...props} pageSize={CONSOLE_PAGE_SIZE} />
}
