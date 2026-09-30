// Hazard 3: a name newer React ships and a hand-kept shim list lacks.
import { ViewTransition, useState } from 'react'

export const kind = typeof ViewTransition
export const hasState = typeof useState
