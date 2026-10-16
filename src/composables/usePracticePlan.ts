import { ref } from 'vue'
import { supabase, VIDEO_BUCKET, isSupabaseConfigured, withSignedUrls } from '@/lib/supabase'
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

// Sort each plan's blocks and sign every clip across the plans in one batch.
async function hydrate(rows: any[]): Promise<PracticePlan[]> {
  const signed = await withSignedUrls(rows.flatMap((r) => (r.videos ?? []) as PracticePlanVideo[]))
  const byId = new Map(signed.map((v) => [v.id, v]))
  return rows.map((row) => ({
    ...row,
    items: [...(row.items ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order),
    videos: ((row.videos ?? []) as PracticePlanVideo[]).map((v) => byId.get(v.id) ?? v),
  })) as PracticePlan[]
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
    else plans.value = sortPlans(await hydrate(data ?? []))
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
    const [plan] = await hydrate([data])
    const without = plans.value.filter((p) => p.id !== plan.id)
    plans.value = sortPlans([...without, plan])
    return plan
  }

  // Returns the ids of the inserted rows, or null on failure.
  async function insertBlocks(planId: string, blocks: TimeBlockDraft[]): Promise<string[] | null> {
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
    if (!rows.length) return []

    const { data, error: insErr } = await supabase
      .from('practice_plan_items')
      .insert(rows)
      .select('id')
    if (insErr) {
      error.value = insErr.message
      return null
    }
    return (data ?? []).map((r: { id: string }) => r.id)
  }

  // On save the blocks are rewritten wholesale rather than diffed — nothing
  // references an item row by id, so a clean replace keeps ordering honest.
  // The new rows go in first and only then are the old ones removed, so a
  // failure part-way leaves the previous blocks in place instead of an empty
  // plan. (If the cleanup fails, the next successful save clears the extras.)
  async function replaceBlocks(planId: string, blocks: TimeBlockDraft[]): Promise<boolean> {
    const keep = await insertBlocks(planId, blocks)
    if (!keep) return false
    let del = supabase.from('practice_plan_items').delete().eq('plan_id', planId)
    if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`)
    const { error: delErr } = await del
    if (delErr) {
      error.value = delErr.message
      return false
    }
    return true
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
    if (!(await insertBlocks(id, blocks))) {
      // Don't leave a half-saved, block-less plan behind: the modal stays open
      // with the coach's edits so they can retry.
      await supabase.from('practice_plans').delete().eq('id', id)
      return null
    }
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
    if (!(await replaceBlocks(id, blocks))) return null
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
    const [video] = await withSignedUrls([data as PracticePlanVideo])

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
