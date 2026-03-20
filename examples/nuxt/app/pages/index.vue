<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <h1 class="mb-2 text-2xl font-bold">Silgi + Nuxt</h1>
    <p class="mb-8 text-sm text-gray-400">Demo pages</p>

    <ul class="space-y-3">
      <li>
        <NuxtLink to="/todos" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Todos</span>
          <span class="ml-2 text-sm text-gray-400">CRUD with typed client</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/auth" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Auth</span>
          <span class="ml-2 text-sm text-gray-400">Login, guard, protected endpoints</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/errors" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Errors</span>
          <span class="ml-2 text-sm text-gray-400">Typed fail() + error handling</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/json" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">JSON</span>
          <span class="ml-2 text-sm text-gray-400">Default protocol</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/msgpack" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">MessagePack</span>
          <span class="ml-2 text-sm text-gray-400">Binary — smaller payloads</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/devalue" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">devalue</span>
          <span class="ml-2 text-sm text-gray-400">Rich types — Date, Map, Set</span>
        </NuxtLink>
      </li>
      <li>
        <a href="/reference" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">API Docs</span>
          <span class="ml-2 text-sm text-gray-400">Scalar — /reference</span>
        </a>
      </li>
    </ul>
  </main>
</template>
