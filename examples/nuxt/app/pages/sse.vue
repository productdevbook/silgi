<script setup lang="ts">
const ticks = ref<Array<{ tick: number; time: string }>>([])
const running = ref(false)
const error = ref('')


async function startClock() {
  running.value = true
  ticks.value = []
  error.value = ''


  try {
    const res = await fetch('/demo/clock', { method: 'POST' })
    if (!res.ok || !res.body) {
      error.value = `HTTP ${res.status}`
      running.value = false
      return
    }


    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''


    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })


      const lines = buffer.split('\n')
      buffer = lines.pop() || ''


      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            ticks.value.push(data)
          } catch {}
        }
      }
    }
  } catch (e: any) {
    error.value = e?.message || 'Connection failed'
  }


  running.value = false
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">SSE / Subscription</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <button
      class="mb-4 rounded-lg px-4 py-2 text-sm text-white"
      :class="running ? 'bg-gray-400' : 'bg-gray-900 hover:bg-gray-800 cursor-pointer'"
      :disabled="running"
      @click="startClock"
    >
      {{ running ? 'Streaming...' : 'Start clock (10 ticks)' }}
    </button>

    <p v-if="error" class="mb-4 text-sm text-red-600">{{ error }}</p>

    <ul class="space-y-1">
      <li
        v-for="t in ticks"
        :key="t.tick"
        class="flex items-center gap-3 rounded border border-gray-100 px-3 py-2 text-sm"
      >
        <span class="w-8 text-right font-mono text-gray-400">#{{ t.tick }}</span>
        <span class="text-gray-600">{{ t.time }}</span>
      </li>
    </ul>

    <p v-if="!running && ticks.length === 0" class="text-center text-sm text-gray-400">
      Click the button to start a 10-tick server-sent event stream.
    </p>
  </main>
</template>
