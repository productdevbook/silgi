<script setup lang="ts">
const messages = ref<Array<{ id: string; direction: 'out' | 'in'; data: unknown; ts: number }>>([])
const connected = ref(false)
const error = ref('')


let ws: WebSocket | null = null
let msgId = 0


function connect() {
  error.value = ''
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}`)


  ws.addEventListener('open', () => {
    connected.value = true
  })


  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    messages.value.push({ id: msg.id, direction: 'in', data: msg, ts: Date.now() })
  })


  ws.addEventListener('close', () => {
    connected.value = false
  })


  ws.addEventListener('error', () => {
    error.value = 'Connection failed'
    connected.value = false
  })
}


function disconnect() {
  ws?.close()
  ws = null
}


function send(path: string, input?: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const id = String(++msgId)
  const payload = { id, path, ...(input !== undefined && { input }) }
  ws.send(JSON.stringify(payload))
  messages.value.push({ id, direction: 'out', data: payload, ts: Date.now() })
}


// ── Demo actions ──


function callHealth() {
  send('demo/slow')
}


function callEcho() {
  send('demo/compute', { a: Math.floor(Math.random() * 100), b: Math.floor(Math.random() * 100), op: 'add' })
}


function callClock() {
  send('demo/clock')
}


function callNotFound() {
  send('does/not/exist')
}


onUnmounted(() => disconnect())
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">WebSocket RPC</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <!-- Connection -->
    <section class="mb-6">
      <div class="flex items-center gap-3">
        <button
          v-if="!connected"
          class="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 cursor-pointer"
          @click="connect"
        >
          Connect
        </button>
        <button
          v-else
          class="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
          @click="disconnect"
        >
          Disconnect
        </button>
        <span class="flex items-center gap-1.5 text-sm">
          <span class="inline-block h-2 w-2 rounded-full" :class="connected ? 'bg-green-500' : 'bg-gray-300'" />
          {{ connected ? 'Connected' : 'Disconnected' }}
        </span>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- Actions -->
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">Send RPC</h2>
      <div class="flex flex-wrap gap-2">
        <button
          :disabled="!connected"
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
          @click="callHealth"
        >
          demo.slow
        </button>
        <button
          :disabled="!connected"
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
          @click="callEcho"
        >
          demo.compute
        </button>
        <button
          :disabled="!connected"
          class="rounded-lg border border-blue-200 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40"
          @click="callClock"
        >
          demo.clock (stream)
        </button>
        <button
          :disabled="!connected"
          class="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
          @click="callNotFound"
        >
          NOT_FOUND
        </button>
      </div>
    </section>

    <!-- Messages -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase text-gray-500">Messages</h2>
        <button v-if="messages.length" class="text-xs text-gray-400 hover:text-gray-600" @click="messages = []">
          Clear
        </button>
      </div>

      <div class="space-y-1.5">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="rounded-lg border p-2.5 text-xs font-mono"
          :class="
            msg.direction === 'out'
              ? 'border-blue-100 bg-blue-50 text-blue-800'
              : 'border-gray-100 bg-gray-50 text-gray-700'
          "
        >
          <span
            class="font-sans text-[10px] font-semibold uppercase"
            :class="msg.direction === 'out' ? 'text-blue-400' : 'text-gray-400'"
          >
            {{ msg.direction === 'out' ? '→ send' : '← recv' }}
          </span>
          <pre class="mt-1 whitespace-pre-wrap break-all">{{ JSON.stringify(msg.data, null, 2) }}</pre>
        </div>
      </div>

      <p v-if="!messages.length" class="text-center text-sm text-gray-400">
        Connect and send an RPC call to see messages.
      </p>
    </section>
  </main>
</template>
