<script lang="ts">
  let health = $state<{ status: string; framework: string } | null>(null);
  let greeting = $state("");
  const name = $state("World");

  async function loadHealth() {
    const res = await fetch("/api/rpc/health", { method: "POST" });
    health = await res.json();
  }

  async function greet() {
    const res = await fetch("/api/rpc/greet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    greeting = data.greeting;
  }

  $effect(() => {
    loadHealth();
  });
</script>

<main style="padding: 2rem; font-family: system-ui">
  <h1>Silgi + SvelteKit</h1>
  <p>Health: {health ? `${health.status} (${health.framework})` : "loading..."}</p>
  <div style="margin-top: 1rem">
    <input bind:value={name} placeholder="Enter your name" />
    <button style="margin-left: 0.5rem" onclick={greet}>Greet</button>
  </div>
  {#if greeting}
    <p style="margin-top: 1rem">{greeting}</p>
  {/if}
</main>
