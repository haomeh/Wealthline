import type { ReactNode } from 'react'

interface Props {
  // Who is signed in (or local mode) and whether the data is saved.
  who: ReactNode
  links: { label: string; detail?: string; onClick: () => void }[]
  // Where the data lives, its size and the backup actions.
  data: ReactNode
  foot: ReactNode
}

// The phone's 更多 tab: the pages the bottom bar leaves out, and the account and data menu.
export function More({ who, links, data, foot }: Props) {
  return <div className="more-page">
    <div className="page-head"><h2>更多</h2></div>
    <section className="panel more-who">{who}</section>
    <ul className="panel more-links">
      {links.map((l) => <li key={l.label}><button onClick={l.onClick}><span>{l.label}</span><span className="muted">{l.detail}{' ›'}</span></button></li>)}
    </ul>
    <span className="more-label">資料</span>
    <section className="panel more-data">{data}</section>
    <section className="panel more-foot">{foot}</section>
  </div>
}
