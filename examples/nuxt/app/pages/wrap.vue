<script setup lang="ts">
const client = useClient()

// Timing wrap
const result = ref<any>(null)
const loading = ref(false)
const duration = ref('')

async function callSlow() {
  loading.value = true
  const start = performance.now()
  result.value = await client.demo.slow()
  duration.value = `${(performance.now() - start).toFixed(0)}ms`
  loading.value = false
}

// HTTP Cache
const httpCache = ref<any>(null)

async function callHttpCached() {
  const start = performance.now()
  httpCache.value = await client.demo.httpCached()
  httpCache.value._ms = `${(performance.now() - start).toFixed(0)}ms`
}

// Server Cache (ocache)
const serverCache = ref<any>(null)

async function callServerCached() {
  const start = performance.now()
  serverCache.value = await client.demo.serverCached()
  serverCache.value._ms = `${(performance.now() - start).toFixed(0)}ms`
}

async function invalidate() {
  await client.demo.invalidateCache()
  serverCache.value = null
}

// Compute
const computeResult = ref('')
const a = ref(10)
const b = ref(3)
const op = ref<'add' | 'sub' | 'mul' | 'div'>('add')

async function callCompute() {
  const data = await client.demo.compute({ a: a.value, b: b.value, op: op.value })
  computeResult.value = data.expression
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">Wrap, Cache & Features</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <!-- Timing wrap -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">Wrap Middleware (timing)</h2>
      <button
        class="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
        :disabled="loading"
        @click="callSlow"
      >
        {{ loading ? 'Running...' : 'Call slow endpoint (100ms)' }}
      </button>
      <div v-if="result" class="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
        <p>{{ result.message }}</p>
        <p class="text-xs text-gray-400">Client: {{ duration }} · Server logs timing via wrap</p>
      </div>
    </section>

    <!-- HTTP Cache -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">HTTP Cache ($route)</h2>
      <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50" @click="callHttpCached">
        Fetch
      </button>
      <div v-if="httpCache" class="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
        <p>
          Random: <strong>{{ httpCache.value.toFixed(4) }}</strong>
        </p>
        <p class="text-xs text-blue-400">{{ httpCache.note }}</p>
        <p class="text-xs text-blue-400">{{ httpCache._ms }}</p>
      </div>
    </section>

    <!-- Server Cache (ocache) -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">Server Cache (ocache)</h2>
      <div class="flex gap-2">
        <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50" @click="callServerCached">
          Fetch
        </button>
        <button
          class="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          @click="invalidate"
        >
          Invalidate
        </button>
      </div>
      <div v-if="serverCache" class="mt-3 rounded-lg border border-green-100 bg-green-50 p-3 text-sm">
        <p>
          Random: <strong>{{ serverCache.value.toFixed(4) }}</strong>
        </p>
        <p class="text-xs text-green-600">DB calls: {{ serverCache.dbCalls }} · {{ serverCache.note }}</p>
        <p class="text-xs text-green-400">{{ serverCache._ms }}</p>
      </div>
    </section>

    <!-- Compute -->
    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">Input Validation</h2>
      <div class="flex items-center gap-2">
        <input v-model.number="a" type="number" class="w-16 rounded border px-2 py-1 text-sm" />
        <select v-model="op" class="rounded border px-2 py-1 text-sm">
          <option value="add">+</option>
          <option value="sub">-</option>
          <option value="mul">×</option>
          <option value="div">÷</option>
        </select>
        <input v-model.number="b" type="number" class="w-16 rounded border px-2 py-1 text-sm" />
        <button class="rounded-lg bg-gray-900 px-3 py-1 text-sm text-white" @click="callCompute">=</button>
        <span v-if="computeResult" class="text-sm font-medium">{{ computeResult }}</span>
      </div>
    </section>
  </main>
</template>
