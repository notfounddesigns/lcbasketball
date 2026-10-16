<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeftIcon, PrinterIcon } from '@heroicons/vue/24/outline'

// The print sheets cover the whole screen (and the tab bar), and the installed
// PWA has no browser back button — so they carry their own way out.
const props = defineProps<{ backTo: string }>()
const router = useRouter()

function print() {
  window.print()
}

function goBack() {
  if (window.history.state?.back) router.back()
  else router.replace(props.backTo)
}
</script>

<template>
  <div class="sticky top-0 z-10 -mx-8 -mt-8 mb-6 flex items-center gap-2 border-b border-gray-200 bg-white/95 px-8 py-3 backdrop-blur print:hidden">
    <button
      class="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100"
      @click="goBack"
    ><ArrowLeftIcon class="h-4 w-4" />Back</button>
    <span class="grow" />
    <button
      class="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800"
      @click="print"
    ><PrinterIcon class="h-4 w-4" />Print</button>
  </div>
</template>
