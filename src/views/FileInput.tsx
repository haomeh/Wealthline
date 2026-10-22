// A file input with its own button and chosen-file text, so the page reads the same whatever
// language the browser shows its native "Choose Files" button in.

import { useRef, useState, type InputHTMLAttributes } from 'react'

export function FileInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const input = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<string[]>([])
  return (
    <span className="file-input">
      <button type="button" onClick={() => input.current?.click()} disabled={props.disabled}>選擇檔案</button>
      <span className="muted small file-input-names">{chosen.length ? chosen.join('、') : '尚未選擇檔案'}</span>
      <input
        {...props}
        ref={input}
        type="file"
        className="file-input-native"
        tabIndex={-1}
        onChange={(e) => {
          setChosen(Array.from(e.target.files ?? [], (f) => f.name))
          props.onChange?.(e)
        }}
      />
    </span>
  )
}
