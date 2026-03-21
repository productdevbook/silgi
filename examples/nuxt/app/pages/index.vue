<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <h1 class="mb-2 text-2xl font-bold">Silgi + Nuxt</h1>
    <p class="mb-8 text-sm text-gray-400">Full-featured demo</p>

    <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Core</h2>
    <ul class="mb-6 space-y-2">
      <li>
        <NuxtLink to="/todos" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Todos</span>
          <span class="ml-2 text-sm text-gray-400">CRUD with typed Silgi client</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/auth" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Auth</span>
          <span class="ml-2 text-sm text-gray-400">Login, guard, session tokens</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/errors" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Errors</span>
          <span class="ml-2 text-sm text-gray-400">Typed fail() + error handling</span>
        </NuxtLink>
      </li>
    </ul>

    <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Features</h2>
    <ul class="mb-6 space-y-2">
      <li>
        <NuxtLink to="/wrap" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">Wrap & Cache</span>
          <span class="ml-2 text-sm text-gray-400">Timing wrap, response cache, computed</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/sse" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">SSE / Subscription</span>
          <span class="ml-2 text-sm text-gray-400">Server-sent events real-time clock</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/ws" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">WebSocket</span>
          <span class="ml-2 text-sm text-gray-400">Bidirectional RPC, streaming, errors</span>
        </NuxtLink>
      </li>
    </ul>

    <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Protocols</h2>
    <ul class="mb-6 space-y-2">
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
    </ul>

    <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Docs</h2>
    <ul class="space-y-2">
      <li>
        <a href="/reference" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">API Reference</span>
          <span class="ml-2 text-sm text-gray-400">Scalar — /reference</span>
        </a>
      </li>
      <li>
        <a href="/openapi.json" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">OpenAPI Spec</span>
          <span class="ml-2 text-sm text-gray-400">JSON — /openapi.json</span>
        </a>
      </li>
    </ul>
  </main>
</template>
