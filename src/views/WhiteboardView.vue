<script setup lang="ts">
import { ref } from 'vue'
import CourtCanvas from '@/components/CourtCanvas.vue'
import type { Diagram } from '@/types'

const diagram = ref<Diagram>({
  courtType: 'half',
  elements: [],
})

const canvasRef = ref<InstanceType<typeof CourtCanvas> | null>(null)
</script>

<template>
  <div class="pt-4">
    <CourtCanvas
      ref="canvasRef"
      v-model="diagram"
      :total-phases="1"
      editable
      @export-png="canvasRef?.exportPng('whiteboard.png')"
    />
  </div>
</template>
