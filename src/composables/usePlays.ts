import { ref } from 'vue'
import { supabase, VIDEO_BUCKET, isSupabaseConfigured } from '@/lib/supabase'
import type { Play, PlayDraft, PlayVideo } from '@/types'

// Module-level singletons — state is shared across all component instances.
// Intentional for a single-coach app; revisit if multi-user context is ever needed.
const plays = ref<Play[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

function resolveVideoUrl(storage_path: string): string | null {
  if (!isSupabaseConfigured) return null
  const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(storage_path)
  return data.publicUrl ?? null
}

export function usePlays() {
  async function fetchPlays() {
    if (!isSupabaseConfigured) {
      error.value = 'Supabase not configured — see README.'
      return
    }
    loading.value = true
    error.value = null
    const { data, error: err } = await supabase
      .from('plays')
      .select('*, videos:play_videos(*)')
      .order('updated_at', { ascending: false })

    if (err) {
      error.value = err.message
    } else {
      plays.value = (data ?? []).map((p: any) => ({
        ...p,
        videos: (p.videos ?? []).map((v: PlayVideo) => ({
          ...v,
          url: resolveVideoUrl(v.storage_path),
        })),
      })) as Play[]
    }
    loading.value = false
  }

  async function createPlay(draft: PlayDraft): Promise<Play | null> {
    const { data, error: err } = await supabase
      .from('plays')
      .insert(draft)
      .select('*, videos:play_videos(*)')
      .single()
    if (err) {
      error.value = err.message
      return null
    }
    const play = data as Play
    plays.value = [play, ...plays.value]
    return play
  }

  async function updatePlay(id: string, patch: Partial<PlayDraft>): Promise<Play | null> {
    const { data, error: err } = await supabase
      .from('plays')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, videos:play_videos(*)')
      .single()
    if (err) {
      error.value = err.message
      return null
    }
    const updated = {
      ...(data as Play),
      videos: ((data as any).videos ?? []).map((v: PlayVideo) => ({
        ...v,
        url: resolveVideoUrl(v.storage_path),
      })),
    }
    plays.value = plays.value.map((p) => (p.id === id ? updated : p))
    return updated
  }

  async function deletePlay(id: string): Promise<boolean> {
    const { error: err } = await supabase.from('plays').delete().eq('id', id)
    if (err) {
      error.value = err.message
      return false
    }
    plays.value = plays.value.filter((p) => p.id !== id)
    return true
  }

  async function duplicatePlay(original: Play): Promise<Play | null> {
    const draft: PlayDraft = {
      name: `${original.name} (copy)`,
      description: original.description ?? '',
      category: original.category ?? '',
      court_type: original.court_type,
      diagram: JSON.parse(JSON.stringify(original.diagram)),
      is_scouting: original.is_scouting,
    }
    return createPlay(draft)
  }

  // Uploads a clip to Storage, records it in play_videos, returns the row.
  async function uploadVideo(
    playId: string,
    file: File,
    title: string | null,
  ): Promise<PlayVideo | null> {
    const ext = file.name.split('.').pop() ?? 'mp4'
    const path = `${playId}/${crypto.randomUUID()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) {
      error.value = upErr.message
      return null
    }

    const { data, error: insErr } = await supabase
      .from('play_videos')
      .insert({ play_id: playId, storage_path: path, title })
      .select('*')
      .single()
    if (insErr) {
      error.value = insErr.message
      return null
    }
    const video: PlayVideo = { ...(data as PlayVideo), url: resolveVideoUrl(path) }

    const play = plays.value.find((p) => p.id === playId)
    if (play) play.videos = [...(play.videos ?? []), video]
    return video
  }

  async function deleteVideo(video: PlayVideo): Promise<boolean> {
    await supabase.storage.from(VIDEO_BUCKET).remove([video.storage_path])
    const { error: err } = await supabase.from('play_videos').delete().eq('id', video.id)
    if (err) {
      error.value = err.message
      return false
    }
    const play = plays.value.find((p) => p.id === video.play_id)
    if (play) play.videos = (play.videos ?? []).filter((v) => v.id !== video.id)
    return true
  }

  return {
    plays,
    loading,
    error,
    fetchPlays,
    createPlay,
    updatePlay,
    deletePlay,
    duplicatePlay,
    uploadVideo,
    deleteVideo,
  }
}
