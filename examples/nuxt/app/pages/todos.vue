<script setup lang="ts">
const client = useClient()


const todos = ref<any[]>([])
const newTitle = ref('')
const loading = ref(true)
const errorMsg = ref('')


onMounted(() => fetchTodos())


async function fetchTodos() {
  loading.value = true
  todos.value = await client.todos.list()
  loading.value = false
}


async function addTodo() {
  if (!newTitle.value.trim()) return
  errorMsg.value = ''
  try {
    await client.todos.create({ title: newTitle.value.trim() })
    newTitle.value = ''
    await fetchTodos()
  } catch (e: any) {
    errorMsg.value = e?.data?.message || e?.message || 'Unknown error'
  }
}


async function toggleTodo(id: number) {
  errorMsg.value = ''
  try {
    await client.todos.toggle({ id })
    await fetchTodos()
  } catch (e: any) {
    errorMsg.value = e?.data?.code || e?.message || 'Unknown error'
  }
}


async function removeTodo(id: number) {
  errorMsg.value = ''
  try {
    await client.todos.remove({ id })
    await fetchTodos()
  } catch (e: any) {
    errorMsg.value = e?.data?.code || e?.message || 'Unknown error'
  }
}


// ── Error triggers for analytics testing ────────────
async function triggerNotFound() {
  errorMsg.value = ''
  try {
    await client.todos.toggle({ id: 99999 })
  } catch (e: any) {
    errorMsg.value = `NOT_FOUND: id=99999 does not exist`
  }
}


async function triggerValidation() {
  errorMsg.value = ''
  try {
    await (client.todos.create as any)({ title: '' })
  } catch (e: any) {
    errorMsg.value = `Validation: empty title rejected`
  }
}


async function triggerBadType() {
  errorMsg.value = ''
  try {
    await (client.todos.toggle as any)({ id: 'not-a-number' })
  } catch (e: any) {
    errorMsg.value = `Bad type: string sent instead of number`
  }
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold">Todos</h1>
      <div class="flex items-center gap-3">
        <a href="/analytics" target="_blank" class="text-sm text-amber-500 hover:text-amber-400">Analytics</a>
        <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">&larr; Back</NuxtLink>
      </div>
    </div>

    <form class="mb-6 flex gap-2" @submit.prevent="addTodo">
      <input
        v-model="newTitle"
        placeholder="What needs to be done?"
        class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
      />
      <button
        type="submit"
        class="cursor-pointer rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
      >
        Add
      </button>
    </form>

    <!-- Error triggers -->
    <div class="mb-6 rounded-lg border border-red-100 bg-red-50 p-3">
      <p class="mb-2 text-xs font-semibold text-red-800">Error Triggers (check /analytics)</p>
      <div class="flex flex-wrap gap-2">
        <button
          class="cursor-pointer rounded border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          @click="triggerNotFound"
        >
          NOT_FOUND (id=99999)
        </button>
        <button
          class="cursor-pointer rounded border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          @click="triggerValidation"
        >
          Validation (empty title)
        </button>
        <button
          class="cursor-pointer rounded border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          @click="triggerBadType"
        >
          Bad Type (string as id)
        </button>
      </div>
      <p v-if="errorMsg" class="mt-2 text-xs text-red-600">{{ errorMsg }}</p>
    </div>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>

    <ul v-else class="m-0 list-none p-0">
      <li v-for="todo in todos" :key="todo.id" class="flex items-center gap-3 border-b border-gray-100 py-2.5">
        <input type="checkbox" :checked="todo.completed" class="cursor-pointer" @change="toggleTodo(todo.id)" />
        <span class="flex-1 text-sm" :class="todo.completed ? 'text-gray-400 line-through' : 'text-gray-900'">
          {{ todo.title }}
        </span>
        <button
          class="cursor-pointer border-none bg-transparent text-xs text-red-600 hover:text-red-800"
          @click="removeTodo(todo.id)"
        >
          Delete
        </button>
      </li>
      <li v-if="todos.length === 0" class="py-4 text-center text-sm text-gray-400">No todos yet.</li>
    </ul>

    <p v-if="todos.length > 0" class="mt-4 text-xs text-gray-400">
      {{ todos.filter((t: any) => t.completed).length }} / {{ todos.length }} completed
    </p>
  </main>
</template>
