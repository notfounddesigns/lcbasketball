<script setup lang="ts">
// Floating +N / -N badges that animate over a box-score cell.
defineProps<{
  items: { id: number; text: string; positive: boolean; color: 'green' | 'red' }[]
}>()
</script>

<template>
  <span class="pointer-events-none absolute inset-0 z-20">
    <span
      v-for="f in items"
      :key="f.id"
      class="stat-flash absolute left-1/2 top-1/2 font-mono text-sm font-black"
      :class="f.color === 'green' ? 'text-green-400' : 'text-red-400'"
    >{{ f.text }}</span>
  </span>
</template>

<style scoped>
.stat-flash {
  transform: translate(-50%, -50%);
  animation: stat-flash-rise 0.85s ease-out forwards;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.65);
  white-space: nowrap;
}
@keyframes stat-flash-rise {
  0% {
    opacity: 0;
    transform: translate(-50%, -10%) scale(0.6);
  }
  20% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -150%) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .stat-flash {
    animation-duration: 0.45s;
  }
}
</style>
