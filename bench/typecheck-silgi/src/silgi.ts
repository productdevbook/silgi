import { silgi } from 'silgi'

const s = silgi({ context: () => ({}) })

export { s as base }
export type { StandardSchemaV1 as Schema } from '@standard-schema/spec'
