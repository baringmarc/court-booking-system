import tileUrl from '../assets/plotline-tile.svg'

/** The Plotline logo tile (docs/BRAND.md): a dusty-rose rounded square with the four-node line chart. Its colors are
    fixed in both themes, as in the brand guide. An image, so its path data stays out of the JS bundle. */
export function PlotlineTile({ size = 32 }: { size?: number }) {
  return <img className="plotline-tile" src={tileUrl} width={size} height={size} alt="" />
}

type LogoProps = { size?: number }

/** Tile and wordmark. The wordmark is live Fraunces text in the theme's text color (cream on brown in dark mode),
    so it follows the brand's primary and secondary logo with no second file. Decorative next to a name: pass it
    inside a link that already has an accessible name, or rely on the visible "plotline" text. */
export function PlotlineLogo({ size = 32 }: LogoProps) {
  return (
    <span className="plotline-logo">
      <PlotlineTile size={size} />
      <span className="plotline-wordmark" style={{ fontSize: Math.round(size * 0.65) }}>plotline</span>
    </span>
  )
}
