<script setup lang="ts">
const client = useClient()


const pingResult = ref<any>(null)
const uppercaseInput = ref('hello world')
const uppercaseResult = ref<any>(null)
const fibInput = ref(10)
const fibResult = ref<any>(null)
const error = ref<string | null>(null)
const loading = ref(false)


async function doPing() {
  error.value = null
  loading.value = true
  try {
    pingResult.value = await client.broker.ping()
  } catch (e: any) {
    error.value = e.message ?? 'Failed — is NATS running? (docker compose up -d)'
  }
  loading.value = false
}


async function doUppercase() {
  error.value = null
  try {
    uppercaseResult.value = await client.broker.uppercase({ text: uppercaseInput.value })
  } catch (e: any) {
    error.value = e.message ?? 'Failed'
  }
}


async function doFib() {
  error.value = null
  try {
    fibResult.value = await client.broker.fib({ n: fibInput.value })
  } catch (e: any) {
    error.value = e.message ?? 'Failed'
  }
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">Broker (NATS)</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">&larr; Back</NuxtLink>
    </div>

    <p class="mb-6 text-sm text-gray-500">
      These calls go from Nuxt &rarr; NATS &rarr; Worker service. The worker runs as a separate process.
    </p>

    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <!-- Ping -->
    <section class="mb-6 rounded-lg border border-gray-200 p-4">
      <h2 class="mb-2 text-sm font-semibold">Ping Worker</h2>
      <button
        class="cursor-pointer rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        :disabled="loading"
        @click="doPing"
      >
        {{ loading ? 'Pinging...' : 'Ping' }}
      </button>
      <pre v-if="pingResult" class="mt-3 rounded bg-gray-100 p-3 text-xs">{{
        JSON.stringify(pingResult, null, 2)
      }}</pre>
    </section>

    <!-- Uppercase -->
    <section class="mb-6 rounded-lg border border-gray-200 p-4">
      <h2 class="mb-2 text-sm font-semibold">Uppercase (remote)</h2>
      <div class="flex gap-2">
        <input
          v-model="uppercaseInput"
          class="flex-1 rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        <button
          class="cursor-pointer rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          @click="doUppercase"
        >
          Send
        </button>
      </div>
      <pre v-if="uppercaseResult" class="mt-3 rounded bg-gray-100 p-3 text-xs">{{
        JSON.stringify(uppercaseResult, null, 2)
      }}</pre>
    </section>

    <!-- Fibonacci -->
    <section class="rounded-lg border border-gray-200 p-4">
      <h2 class="mb-2 text-sm font-semibold">Fibonacci (remote compute)</h2>
      <div class="flex gap-2">
        <input
          v-model.number="fibInput"
          type="number"
          min="0"
          max="40"
          class="w-24 rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        <button
          class="cursor-pointer rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          @click="doFib"
        >
          Compute
        </button>
      </div>
      <pre v-if="fibResult" class="mt-3 rounded bg-gray-100 p-3 text-xs">{{ JSON.stringify(fibResult, null, 2) }}</pre>
    </section>
  </main>
</template>
