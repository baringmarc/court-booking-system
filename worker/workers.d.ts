// The Cloudflare Workers globals this Worker uses (HTMLRewriter), declared by hand so the DOM lib covers the rest
// (Request, Response, Cache, AbortSignal). https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/

interface HTMLRewriterElement {
  setInnerContent(content: string, options?: { html?: boolean }): HTMLRewriterElement
  append(content: string, options?: { html?: boolean }): HTMLRewriterElement
}

interface HTMLRewriterElementHandlers {
  element?(element: HTMLRewriterElement): void | Promise<void>
}

declare class HTMLRewriter {
  constructor()
  on(selector: string, handlers: HTMLRewriterElementHandlers): HTMLRewriter
  transform(response: Response): Response
}
