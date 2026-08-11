import { ref } from 'vue'
import { supabase, VIDEO_BUCKET, isSupabaseConfigured } from '@/lib/supabase'
import type {
  PracticePlan,
  PracticePlanDraft,
  PracticePlanVideo,
  TimeBlockDraft,
} from '@/types'

// Module-level singletons — shared across component instances, matching usePlays.
const plans = ref<PracticePlan[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Plans always travel with their time blocks and clips: the grid needs block
// counts and totals, and the viewer/print sheet need the whole thing.
const PLAN_SELECT =
  '*, items:practice_plan_items(*, play:plays(id, name, diagram)), videos:practice_plan_videos(*)'

function resolveVideoUrl(storage_path: string): string | null {
  if (!isSupabaseConfigured) return null
  const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(storage_path)
  return data.publicUrl ?? null
}

function hydrate(row: any): PracticePlan {
  return {
    ...row,
    items: [...(row.items ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order),
    videos: (row.videos ?? []).map((v: PracticePlanVideo) => ({
      ...v,
      url: resolveVideoUrl(v.storage_path),
    })),
  } as PracticePlan
}

// Most recent practice first; undated plans sink to the bottom.
function sortPlans(list: PracticePlan[]): PracticePlan[] {
  return [...list].sort((a, b) => {
    if (a.planned_for !== b.planned_for) {
      if (!a.planned_for) return 1
      if (!b.planned_for) return -1
      return a.planned_for < b.planned_for ? 1 : -1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

export function usePracticePlan() {
  async function fetchPlans() {
    if (!isSupabaseConfigured) {
      error.value = 'Supabase not configured — see README.'
      return
    }
    loading.value = true
    error.value = null
    const { data, error: err } = await supabase
      .from('practice_plans')
      .select(PLAN_SELECT)
      .order('planned_for', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (err) error.value = err.message
    else plans.value = sortPlans((data ?? []).map(hydrate))
    loading.value = false
  }

  // Re-reads one plan with its blocks/clips and folds it into the local list.
  async function reloadPlan(id: string): Promise<PracticePlan | null> {
    const { data, error: err } = await supabase
      .from('practice_plans')
      .select(PLAN_SELECT)
      .eq('id', id)
      .single()
    if (err) {
      error.value = err.message
      return null
    }
    const plan = hydrate(data)
    const without = plans.value.filter((p) => p.id !== plan.id)
    plans.value = sortPlans([...without, plan])
    return plan
  }

  async function insertBlocks(planId: string, blocks: TimeBlockDraft[]): Promise<boolean> {
    const rows = blocks
      .filter((b) => b.label.trim() || b.play_id || b.notes.trim())
      .map((b, i) => ({
        plan_id: planId,
        play_id: b.play_id,
        label: b.label.trim() || null,
        duration_min: Math.max(1, Math.round(b.duration_min) || 1),
        sort_order: i,
        notes: b.notes.trim() || null,
      }))
    if (!rows.length) return true

    const { error: insErr } = await supabase.from('practice_plan_items').insert(rows)
    if (insErr) {
      error.value = insErr.message
      return false
    }
    return true
  }

  // On save the blocks are rewritten wholesale rather than diffed — nothing
  // references an item row by id, so a clean replace keeps ordering honest.
  async function replaceBlocks(planId: string, blocks: TimeBlockDraft[]): Promise<boolean> {
    const { error: delErr } = await supabase
      .from('practice_plan_items')
      .delete()
      .eq('plan_id', planId)
    if (delErr) {
      error.value = delErr.message
      return false
    }
    return insertBlocks(planId, blocks)
  }

  async function createPlan(
    draft: PracticePlanDraft,
    blocks: TimeBlockDraft[],
  ): Promise<PracticePlan | null> {
    error.value = null
    const { data, error: err } = await supabase
      .from('practice_plans')
      .insert(draft)
      .select('id')
      .single()
    if (err) {
      error.value = err.message
      return null
    }
    const id = (data as { id: string }).id
    await insertBlocks(id, blocks)
    return reloadPlan(id)
  }

  async function updatePlan(
    id: string,
    draft: PracticePlanDraft,
    blocks: TimeBlockDraft[],
  ): Promise<PracticePlan | null> {
    error.value = null
    const { error: err } = await supabase.from('practice_plans').update(draft).eq('id', id)
    if (err) {
      error.value = err.message
      return null
    }
    await replaceBlocks(id, blocks)
    return reloadPlan(id)
  }

  async function deletePlan(id: string): Promise<boolean> {
    // Drop the blobs first — the rows cascade, and orphaned files can't be
    // found again once their rows are gone.
    const plan = plans.value.find((p) => p.id === id)
    const paths = (plan?.videos ?? []).map((v) => v.storage_path)
    if (paths.length) await supabase.storage.from(VIDEO_BUCKET).remove(paths)

    const { error: err } = await supabase.from('practice_plans').delete().eq('id', id)
    if (err) {
      error.value = err.message
      return false
    }
    plans.value = plans.value.filter((p) => p.id !== id)
    return true
  }

  async function uploadPlanVideo(
    planId: string,
    file: File,
    title: string | null,
  ): Promise<PracticePlanVideo | null> {
    const ext = file.name.split('.').pop() ?? 'mp4'
    const path = `practice/${planId}/${crypto.randomUUID()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) {
      error.value = upErr.message
      return null
    }

    const { data, error: insErr } = await supabase
      .from('practice_plan_videos')
      .insert({ plan_id: planId, storage_path: path, title })
      .select('*')
      .single()
    if (insErr) {
      error.value = insErr.message
      return null
    }
    const video: PracticePlanVideo = { ...(data as PracticePlanVideo), url: resolveVideoUrl(path) }

    const plan = plans.value.find((p) => p.id === planId)
    if (plan) plan.videos = [...(plan.videos ?? []), video]
    return video
  }

  async function deletePlanVideo(video: PracticePlanVideo): Promise<boolean> {
    await supabase.storage.from(VIDEO_BUCKET).remove([video.storage_path])
    const { error: err } = await supabase
      .from('practice_plan_videos')
      .delete()
      .eq('id', video.id)
    if (err) {
      error.value = err.message
      return false
    }
    const plan = plans.value.find((p) => p.id === video.plan_id)
    if (plan) plan.videos = (plan.videos ?? []).filter((v) => v.id !== video.id)
    return true
  }

  return {
    plans,
    loading,
    error,
    fetchPlans,
    reloadPlan,
    createPlan,
    updatePlan,
    deletePlan,
    uploadPlanVideo,
    deletePlanVideo,
  }
}
