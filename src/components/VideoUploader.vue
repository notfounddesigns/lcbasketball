<script setup lang="ts">
import { ref } from 'vue'
import type { Play, PlayVideo } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps<{ play: Play }>()
const { uploadVideo, deleteVideo } = usePlays()
const { confirm } = useConfirm()

const fileInput = ref<HTMLInputElement | null>(null)
const title = ref('')
const busy = ref(false)
const localError = ref<string | null>(null)

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

async function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('video/')) {
    localError.value = 'Pick a video file (mp4, mov, webm).'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    localError.value = `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`
    if (fileInput.value) fileInput.value.value = ''
    return
  }
  busy.value = true
  localError.value = null
  const res = await uploadVideo(props.play.id, file, title.value || file.name)
  if (!res) localError.value = 'Upload failed — check Storage bucket & policies.'
  title.value = ''
  if (fileInput.value) fileInput.value.value = ''
  busy.value = false
}

async function remove(v: PlayVideo) {
  const ok = await confirm({
    title: 'Remove clip',
    message: `Remove clip "${v.title ?? 'untitled'}"?`,
    confirmText: 'Remove',
    tone: 'danger',
  })
  if (!ok) return
  await deleteVideo(v)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end gap-2">
      <div class="grow">
        <label class="label" for="clip-title">Clip title (optional)</label>
        <input id="clip-title" v-model="title" class="input" placeholder="e.g. vs Eagles — 3rd quarter" />
      </div>
      <button class="btn-primary" :disabled="busy" @click="fileInput?.click()">
        {{ busy ? 'Uploading…' : 'Upload clip' }}
      </button>
      <input ref="fileInput" type="file" accept="video/*" class="hidden" @change="onPick" />
    </div>

    <p v-if="localError" class="text-sm text-red-400">{{ localError }}</p>

    <p v-if="!play.videos?.length" class="text-sm text-ink-500">
      No clips yet. Upload an example to show how this play runs.
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <figure v-for="v in play.videos" :key="v.id" class="card overflow-hidden">
        <video v-if="v.url" :src="v.url" controls preload="metadata" class="aspect-video w-full bg-black" />
        <figcaption class="flex items-center justify-between gap-2 p-2 text-sm">
          <span class="truncate">{{ v.title ?? 'Untitled clip' }}</span>
          <button class="text-xs text-red-400 hover:text-red-300" @click="remove(v)">Remove</button>
        </figcaption>
      </figure>
    </div>
  </div>
</template>
