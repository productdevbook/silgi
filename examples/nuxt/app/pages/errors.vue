<script setup lang="ts">
const client = useClient()

const results = ref<Array<{ action: string; status: string; detail: string }>>([])

async function testNotFound() {
  try {
    await client.todos.toggle({ id: 999 })
    addResult('toggle(999)', 'success', 'Should not reach here')
  } catch (e: any) {
    addResult('toggle(999)', 'error', `${e?.data?.code || e?.code} — ${e?.data?.message || e?.message}`)
  }
}

async function testValidation() {
  try {
    await client.todos.create({ title: '' })
    addResult('create("")', 'success', 'Should not reach here')
  } catch (e: any) {
    addResult('create("")', 'error', `${e?.data?.code || e?.code} — validation failed`)
  }
}

async function testUnauthorized() {
  try {
    await client.auth.me({ token: 'invalid_token' })
    addResult('me(invalid)', 'success', 'Should not reach here')
  } catch (e: any) {
    addResult('me(invalid)', 'error', `${e?.data?.code || e?.code} — ${e?.data?.message || e?.message}`)
  }
}

async function testSuccess() {
  try {
    const data = await client.todos.list()
    addResult('list()', 'success', `${data.length} todos`)
  } catch (e: any) {
    addResult('list()', 'error', e?.message)
  }
}

function addResult(action: string, status: string, detail: string) {
  results.value.push({ action, status, detail })
}

function clear() {
  results.value = []
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">Error Handling</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <div class="mb-6 flex flex-wrap gap-2">
      <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50" @click="testSuccess">
        Success
      </button>
      <button
        class="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        @click="testNotFound"
      >
        NOT_FOUND
      </button>
      <button
        class="rounded-lg border border-orange-200 px-3 py-1.5 text-sm text-orange-600 hover:bg-orange-50"
        @click="testValidation"
      >
        Validation
      </button>
      <button
        class="rounded-lg border border-purple-200 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50"
        @click="testUnauthorized"
      >
        UNAUTHORIZED
      </button>
      <button v-if="results.length" class="text-xs text-gray-400 hover:text-gray-600" @click="clear">Clear</button>
    </div>

    <ul class="space-y-2">
      <li
        v-for="(r, i) in results"
        :key="i"
        class="rounded-lg border px-3 py-2 text-sm"
        :class="r.status === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'"
      >
        <span class="font-mono text-xs" :class="r.status === 'success' ? 'text-green-700' : 'text-red-700'">
          {{ r.action }}
        </span>
        <span class="ml-2 text-gray-600">{{ r.detail }}</span>
      </li>
    </ul>

    <p v-if="results.length === 0" class="text-center text-sm text-gray-400">
      Click a button above to test error handling.
    </p>
  </main>
</template>
