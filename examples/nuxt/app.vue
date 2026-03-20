<script setup lang="ts">
interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: string
}

const todos = ref<Todo[]>([])
const newTitle = ref('')
const loading = ref(true)

onMounted(async () => {
  await fetchTodos()
})

async function fetchTodos() {
  loading.value = true
  const data = await $fetch('/todos/list', { method: 'GET' })
  todos.value = data as Todo[]
  loading.value = false
}

async function addTodo() {
  if (!newTitle.value.trim()) return
  await $fetch('/todos/create', {
    method: 'POST',
    body: { title: newTitle.value.trim() },
  })
  newTitle.value = ''
  await fetchTodos()
}

async function toggleTodo(id: number) {
  await $fetch('/todos/toggle', {
    method: 'POST',
    body: { id },
  })
  await fetchTodos()
}

async function removeTodo(id: number) {
  await $fetch('/todos/remove', {
    method: 'POST',
    body: { id },
  })
  await fetchTodos()
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <h1 class="mb-1 text-2xl font-bold">Silgi + Nuxt — Todo</h1>
    <p class="mb-6 text-sm text-gray-400">Type-safe RPC with Silgi</p>

    <!-- Add todo -->
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

    <!-- Loading -->
    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>

    <!-- Todo list -->
    <ul v-else class="m-0 list-none p-0">
      <li
        v-for="todo in todos"
        :key="todo.id"
        class="flex items-center gap-3 border-b border-gray-100 py-2.5"
      >
        <input
          type="checkbox"
          :checked="todo.completed"
          class="cursor-pointer"
          @change="toggleTodo(todo.id)"
        />
        <span
          class="flex-1 text-sm"
          :class="todo.completed ? 'text-gray-400 line-through' : 'text-gray-900'"
        >
          {{ todo.title }}
        </span>
        <button
          class="cursor-pointer border-none bg-transparent text-xs text-red-600 hover:text-red-800"
          @click="removeTodo(todo.id)"
        >
          Delete
        </button>
      </li>

      <li v-if="todos.length === 0" class="py-4 text-center text-sm text-gray-400">
        No todos yet. Add one above.
      </li>
    </ul>

    <p v-if="todos.length > 0" class="mt-4 text-xs text-gray-400">
      {{ todos.filter((t) => t.completed).length }} / {{ todos.length }} completed
    </p>
  </main>
</template>
