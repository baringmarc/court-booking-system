import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SimpleMarkdown } from './SimpleMarkdown'

describe('SimpleMarkdown', () => {
  it('renders paragraphs, line breaks and bold', () => {
    const { container } = render(<SimpleMarkdown text={'**GCash**: 0917\n**Maya**: 0918\n\nUse your reference.'} />)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].querySelectorAll('strong')).toHaveLength(2)
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(1)
    expect(paragraphs[1]).toHaveTextContent('Use your reference.')
  })

  it('never renders HTML from the text', () => {
    const { container } = render(<SimpleMarkdown text={'<img src=x onerror=alert(1)> **ok**'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)> ok')
  })
})
