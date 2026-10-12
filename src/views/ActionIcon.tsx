const paths = {
  previous: 'M14 6l-6 6 6 6',
  next: 'M10 6l6 6-6 6',
  view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  tag: 'M3 3h7l11 11-7 7L3 10V3Z M7 7h.01',
  edit: 'M15 5l4 4 M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15v5Z',
  add: 'M12 5v14 M5 12h14',
  undo: 'M4 10h9a6 6 0 0 1 0 12 M4 10l5-5 M4 10l5 5',
  calendar: 'M8 3v4 M16 3v4 M4 10h16 M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1 M8 14h2 M14 14h2',
  delete: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
}

export function ActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
