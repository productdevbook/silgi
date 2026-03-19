<script setup lang="ts">
const health = ref<{ status: string; framework: string } | null>(null)
const greeting = ref('')
const name = ref('World')


onMounted(async () => {
  const data = await $fetch('/rpc/health', { method: 'POST' })
  health.value = data as { status: string; framework: string }
})


async function greet() {
  const data = await $fetch('/rpc/greet', {
    method: 'POST',
    body: { name: name.value },
  })
  greeting.value = (data as { greeting: string }).greeting
}
</script>

<template>
  <main style="padding: 2rem; font-family: system-ui">
    <h1>Katman + Nuxt</h1>
    <p>Health: {{ health ? `${health.status} (${health.framework})` : 'loading...' }}</p>
    <div style="margin-top: 1rem">
      <input v-model="name" placeholder="Enter your name" />
      <button style="margin-left: 0.5rem" @click="greet">Greet</button>
    </div>
    <p v-if="greeting" style="margin-top: 1rem">{{ greeting }}</p>
  </main>
</template>
