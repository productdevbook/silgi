import { defineHandler } from 'nitro/h3'

export default defineHandler(() => ({
  name: 'Silgi Nitro Playground',
  routes: {
    'POST /rpc/health': 'Health check',
    'POST /rpc/users/list': 'List users (input: { limit?: number })',
    'POST /rpc/users/get': 'Get user (input: { id: number })',
    'POST /rpc/users/create': 'Create user (auth required, input: { name, email })',
  },
  auth: 'Bearer secret-token',
}))
