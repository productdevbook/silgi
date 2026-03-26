<script setup lang="ts">
const client = useClient({ protocol: 'messagepack' })


const todos = ref<any[]>([])
const newTitle = ref('')
const loading = ref(true)
const responseInfo = ref('')


onMounted(() => fetchTodos())


async function fetchTodos() {
  loading.value = true
  const start = performance.now()
  todos.value = await client.todos.list()
  responseInfo.value = `MessagePack (binary) — ${(performance.now() - start).toFixed(1)}ms`
  loading.value = false
}


async function addTodo() {
  if (!newTitle.value.trim()) return
  await client.todos.create({ title: newTitle.value.trim() })
  newTitle.value = ''
  await fetchTodos()
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">MessagePack Protocol</h1>
        <p class="text-xs text-gray-400">{{ responseInfo }}</p>
      </div>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <form class="mb-6 flex gap-2" @submit.prevent="addTodo">
      <input
        v-model="newTitle"
        placeholder="Add todo..."
        class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
      />
      <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Add</button>
    </form>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
    <ul v-else class="list-none p-0">
      <li v-for="todo in todos" :key="todo.id" class="border-b border-gray-100 py-2 text-sm">{{ todo.title }}</li>
    </ul>
  </main>
</template>
