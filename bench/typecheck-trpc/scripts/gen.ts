import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NUM_ROUTERS = 500
const ROUTER_DIR = path.resolve(__dirname, '../src/router')
const CONSUME_DIR = path.resolve(__dirname, '../src/consume')

const PROCEDURE_1 = `procedure.input({} as Schema<{ who: string }, { who: string }>).query(({input}) => \`hello \${input.who}\`)`
const PROCEDURE_2 = `procedure.input({} as Schema<{ id: string }, { id: string }>).mutation(({input}) => ({ id: input.id }))`

function createRouter(name: string): string {
  return `import { procedure, router, Schema } from '../trpc'

export const ${name} = router({
  procedure_1: ${PROCEDURE_1},
  procedure_2: ${PROCEDURE_2},
  nested: router({
    procedure_1: ${PROCEDURE_1},
    procedure_2: ${PROCEDURE_2},
    nested: router({
      procedure_1: ${PROCEDURE_1},
      procedure_2: ${PROCEDURE_2},
    }),
  }),
})`
}

function createConsume(name: string): string {
  return `import { client } from '../client'

const procedure_1: string = await client.router_0.procedure_1.query({ who: 'world' })
const procedure_2: { id: string } = await client.router_0.procedure_2.mutate({ id: '123' })
const nested_procedure_1: string = await client.${name}.nested.procedure_1.query({ who: 'world' })
const nested_procedure_2: { id: string } = await client.${name}.nested.procedure_2.mutate({ id: '123' })
const nested_nested_procedure_1: string = await client.${name}.nested.nested.procedure_1.query({ who: 'world' })
const nested_nested_procedure_2: { id: string } = await client.${name}.nested.nested.procedure_2.mutate({ id: '123' })`
}

const names = Array.from({ length: NUM_ROUTERS }, (_, i) => `router_${i}`)

await fs.rm(ROUTER_DIR, { recursive: true, force: true })
await fs.rm(CONSUME_DIR, { recursive: true, force: true })
await fs.mkdir(ROUTER_DIR, { recursive: true })
await fs.mkdir(CONSUME_DIR, { recursive: true })

await Promise.all(
  names.map(async (name) => {
    await fs.writeFile(path.join(ROUTER_DIR, `${name}.ts`), createRouter(name))
    await fs.writeFile(path.join(CONSUME_DIR, `${name}.ts`), createConsume(name))
  }),
)

const index = `import { router as routerFn } from '../trpc'
${names.map((n) => `import { ${n} } from './${n}'`).join('\n')}

export const router = routerFn({
  ${names.join(',\n  ')},
})
`
await fs.writeFile(path.join(ROUTER_DIR, 'index.ts'), index)
console.log(`Generated ${NUM_ROUTERS} routers (${NUM_ROUTERS * 6} procedures)`)
