'use server'

import {
  createOptionList,
  createOptionListItem,
  deleteOptionList,
  updateOptionList,
  updateOptionListItem,
} from '@/lib/admin/option-lists'

export async function createListAction(input: { slug: string; name: string; description?: string }) {
  return createOptionList(input)
}

export async function updateListAction(id: string, patch: { name?: string; description?: string }) {
  return updateOptionList(id, patch)
}

export async function deleteListAction(id: string) {
  return deleteOptionList(id)
}

export async function createItemAction(input: {
  option_list_id: string
  key: string
  label: string
  sort_order?: number
}) {
  return createOptionListItem(input)
}

export async function updateItemAction(
  id: string,
  patch: { label?: string; sort_order?: number; is_active?: boolean },
) {
  return updateOptionListItem(id, patch)
}
