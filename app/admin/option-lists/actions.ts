'use server'

import {
  addOptionListItem,
  createOptionList,
  createOptionListItem,
  deactivateOptionListItem,
  deleteOptionList,
  reactivateOptionListItem,
  renameOptionListItemLabel,
  reorderOptionListItems,
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

export async function addItemAction(input: {
  option_list_id: string
  key: string
  label: string
  sort_order?: number
}) {
  return addOptionListItem(input)
}

export async function updateItemAction(
  id: string,
  patch: { label?: string; sort_order?: number; is_active?: boolean },
) {
  return updateOptionListItem(id, patch)
}

export async function renameItemLabelAction(id: string, newLabel: string) {
  return renameOptionListItemLabel(id, newLabel)
}

export async function deactivateItemAction(id: string) {
  return deactivateOptionListItem(id)
}

export async function reactivateItemAction(id: string) {
  return reactivateOptionListItem(id)
}

export async function reorderItemsAction(optionListId: string, orderedItemIds: string[]) {
  return reorderOptionListItems(optionListId, orderedItemIds)
}
