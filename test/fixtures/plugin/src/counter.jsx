import * as React from 'react'
import { useState, forwardRef, memo } from 'react'

export const getReact = () => React
export const Counter = memo(
  forwardRef(function Counter(_p, ref) {
    const [n, setN] = useState(41)
    return (
      <button ref={ref} id="plugin-btn" onClick={() => setN(n + 1)}>
        count:{n}
      </button>
    )
  }),
)
