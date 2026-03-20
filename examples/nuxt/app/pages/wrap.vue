<script setup lang="ts">
const client = useClient()


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


const cached = ref<any>(null)


async function callCached() {
  const start = performance.now()
  cached.value = await client.demo.cached()
  cached.value._clientMs = `${(performance.now() - start).toFixed(0)}ms`
}


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
      <h1 class="text-xl font-bold">Wrap & Features</h1>
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
        {{ loading ? 'Running...' : 'Call slow endpoint (100ms delay)' }}
      </button>
      <div v-if="result" class="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
        <p>{{ result.message }}</p>
        <p class="text-xs text-gray-400">Client: {{ duration }} · Server logs timing via wrap</p>
      </div>
    </section>

    <!-- Cache -->
    <section class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-gray-500">Response Cache</h2>
      <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50" @click="callCached">
        Fetch cached value
      </button>
      <div v-if="cached" class="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
        <p>
          Random: <strong>{{ cached.value.toFixed(4) }}</strong>
        </p>
        <p class="text-xs text-gray-400">{{ cached.note }}</p>
        <p class="text-xs text-gray-400">Client: {{ cached._clientMs }}</p>
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
