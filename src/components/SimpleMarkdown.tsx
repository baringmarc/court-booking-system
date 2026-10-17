import { Fragment, type ReactNode } from 'react'

/**
 * Renders the tiny markdown subset used in venue settings: paragraphs (blank lines),
 * line breaks and **bold**. Everything else is plain text; React escapes it, so no HTML is injected.
 */
export function SimpleMarkdown({ text }: { text: string }) {
  const paragraphs = text.trim().split(/\n{2,}/).filter(Boolean)
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i}>
          {para.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {renderBold(line)}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  )
}

function renderBold(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={k}>{part.slice(2, -2)}</strong> : part,
  )
}
