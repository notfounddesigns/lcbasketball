<script setup lang="ts">
  import CourtCanvas from '@/components/CourtCanvas.vue'
  import { Diagram } from '@/types';
  import { ref } from 'vue';

  const diagram = ref<Diagram>({
    courtType: 'half',
    elements: [],
  })
</script>
<template>
  <div class="pt-4">
    <CourtCanvas v-model="diagram" :total-phases="1" editable tool="pen" />
  </div>
</template> 
