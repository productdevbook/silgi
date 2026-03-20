<script setup lang="ts">
const client = useClient()


const username = ref('admin')
const password = ref('any')
const token = ref('')
const user = ref<{ id: number; username: string; role: string } | null>(null)
const error = ref('')


async function login() {
  error.value = ''
  try {
    const result = await client.auth.login({ username: username.value, password: password.value })
    token.value = result.token
    await fetchMe()
  } catch (e: any) {
    error.value = e?.data?.code || e?.message || 'Login failed'
  }
}


async function fetchMe() {
  try {
    user.value = await client.auth.me({ token: token.value })
  } catch {
    user.value = null
  }
}


async function logout() {
  await client.auth.logout({ token: token.value })
  token.value = ''
  user.value = null
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">Auth</h1>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <!-- Not logged in -->
    <div v-if="!user" class="space-y-4">
      <div>
        <label class="mb-1 block text-xs text-gray-500">Username</label>
        <input
          v-model="username"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs text-gray-500">Password</label>
        <input
          v-model="password"
          type="password"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button
        class="w-full cursor-pointer rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        @click="login"
      >
        Login
      </button>
      <p class="text-xs text-gray-400">Try: admin / any password</p>
    </div>

    <!-- Logged in -->
    <div v-else class="space-y-4">
      <div class="rounded-lg border border-green-200 bg-green-50 p-4">
        <p class="text-sm font-medium text-green-800">Logged in as {{ user.username }}</p>
        <p class="text-xs text-green-600">Role: {{ user.role }} · ID: {{ user.id }}</p>
      </div>
      <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p class="mb-1 text-xs text-gray-500">Token</p>
        <code class="break-all text-xs text-gray-600">{{ token }}</code>
      </div>
      <button
        class="w-full cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
        @click="logout"
      >
        Logout
      </button>
    </div>
  </main>
</template>
