// A host-provided module plugins reach through `shared` (the @nanite/ui/* pattern).
const token = { made: 'once' }
export const tag = () => token
export const label = 'host-ui'
