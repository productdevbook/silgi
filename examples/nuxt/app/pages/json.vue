<script setup lang="ts">
import { createClient } from 'silgi/client'
import { createLink } from 'silgi/client/ofetch'

import type { AppRouter } from '../server/rpc/router'

const link = createLink({ url: '' })
const client = createClient<AppRouter>(link)

const todos = ref<any[]>([])
const newTitle = ref('')
const loading = ref(true)
const responseInfo = ref('')

onMounted(async () => {
  await fetchTodos()
})

async function fetchTodos() {
  loading.value = true
  const start = performance.now()
  const data = await client.todos.list()
  const ms = (performance.now() - start).toFixed(1)
  todos.value = data as any[]
  responseInfo.value = `JSON — ${ms}ms`
  loading.value = false
}

async function addTodo() {
  if (!newTitle.value.trim()) return
  await client.todos.create({ title: newTitle.value.trim() })
  newTitle.value = ''
  await fetchTodos()
}

async function toggleTodo(id: number) {
  await client.todos.toggle({ id })
  await fetchTodos()
}

async function removeTodo(id: number) {
  await client.todos.remove({ id })
  await fetchTodos()
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">JSON Protocol</h1>
        <p class="text-xs text-gray-400">{{ responseInfo }}</p>
      </div>
      <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600">← Back</NuxtLink>
    </div>

    <form class="mb-6 flex gap-2" @submit.prevent="addTodo">
      <input
        v-model="newTitle"
        placeholder="What needs to be done?"
        class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
      />
      <button type="submit" class="cursor-pointer rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800">
        Add
      </button>
    </form>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>

    <ul v-else class="m-0 list-none p-0">
      <li v-for="todo in todos" :key="todo.id" class="flex items-center gap-3 border-b border-gray-100 py-2.5">
        <input type="checkbox" :checked="todo.completed" class="cursor-pointer" @change="toggleTodo(todo.id)" />
        <span class="flex-1 text-sm" :class="todo.completed ? 'text-gray-400 line-through' : 'text-gray-900'">
          {{ todo.title }}
        </span>
        <button class="cursor-pointer border-none bg-transparent text-xs text-red-600 hover:text-red-800" @click="removeTodo(todo.id)">
          Delete
        </button>
      </li>
      <li v-if="todos.length === 0" class="py-4 text-center text-sm text-gray-400">No todos yet.</li>
    </ul>
  </main>
</template>
