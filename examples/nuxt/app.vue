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
  const data = await $fetch('/rpc/todos/list', { method: 'GET' })
  todos.value = data as Todo[]
  loading.value = false
}


async function addTodo() {
  if (!newTitle.value.trim()) return
  await $fetch('/rpc/todos/create', {
    method: 'POST',
    body: { title: newTitle.value.trim() },
  })
  newTitle.value = ''
  await fetchTodos()
}


async function toggleTodo(id: number) {
  await $fetch('/rpc/todos/toggle', {
    method: 'POST',
    body: { id },
  })
  await fetchTodos()
}


async function removeTodo(id: number) {
  await $fetch('/rpc/todos/remove', {
    method: 'POST',
    body: { id },
  })
  await fetchTodos()
}
</script>

<template>
  <main style="max-width: 480px; margin: 3rem auto; font-family: system-ui; padding: 0 1rem">
    <h1 style="font-size: 1.5rem; margin-bottom: 0.25rem">Silgi + Nuxt — Todo</h1>
    <p style="color: #888; margin-bottom: 1.5rem; font-size: 0.875rem">Type-safe RPC with Silgi</p>

    <!-- Add todo -->
    <form style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem" @submit.prevent="addTodo">
      <input
        v-model="newTitle"
        placeholder="What needs to be done?"
        style="flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem"
      />
      <button
        type="submit"
        style="
          padding: 0.5rem 1rem;
          background: #111;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.875rem;
        "
      >
        Add
      </button>
    </form>

    <!-- Loading -->
    <p v-if="loading" style="color: #888">Loading...</p>

    <!-- Todo list -->
    <ul v-else style="list-style: none; padding: 0; margin: 0">
      <li
        v-for="todo in todos"
        :key="todo.id"
        style="display: flex; align-items: center; gap: 0.75rem; padding: 0.625rem 0; border-bottom: 1px solid #eee"
      >
        <input type="checkbox" :checked="todo.completed" style="cursor: pointer" @change="toggleTodo(todo.id)" />
        <span
          style="flex: 1; font-size: 0.875rem"
          :style="{ textDecoration: todo.completed ? 'line-through' : 'none', color: todo.completed ? '#aaa' : '#111' }"
        >
          {{ todo.title }}
        </span>
        <button
          style="background: none; border: none; color: #c00; cursor: pointer; font-size: 0.75rem"
          @click="removeTodo(todo.id)"
        >
          Delete
        </button>
      </li>

      <li v-if="todos.length === 0" style="padding: 1rem 0; color: #888; text-align: center">
        No todos yet. Add one above.
      </li>
    </ul>

    <p v-if="todos.length > 0" style="margin-top: 1rem; font-size: 0.75rem; color: #888">
      {{ todos.filter((t) => t.completed).length }} / {{ todos.length }} completed
    </p>
  </main>
</template>
