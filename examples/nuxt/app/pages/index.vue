<template>
  <main class="mx-auto max-w-lg px-4 py-12 font-sans">
    <h1 class="mb-2 text-2xl font-bold">Silgi + Nuxt</h1>
    <p class="mb-8 text-sm text-gray-400">Protocol demos</p>

    <ul class="space-y-3">
      <li>
        <NuxtLink to="/json" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">JSON</span>
          <span class="ml-2 text-sm text-gray-400">Default — plain application/json</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/msgpack" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">MessagePack</span>
          <span class="ml-2 text-sm text-gray-400">Binary — smaller payloads, faster parsing</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink to="/devalue" class="block rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-400">
          <span class="font-medium">devalue</span>
          <span class="ml-2 text-sm text-gray-400">Rich types — Date, Map, Set, BigInt</span>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
