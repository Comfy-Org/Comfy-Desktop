type FieldLike = Record<string, unknown>

function editableId(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null
  const f = field as FieldLike
  return f.editable && typeof f.id === 'string' ? f.id : null
}

export function editableFieldIds(sections: unknown[]): Set<string> {
  const ids = new Set<string>(['name', 'seen'])
  for (const section of sections) {
    const fields = (section as FieldLike).fields as FieldLike[] | undefined
    for (const field of fields ?? []) {
      for (const candidate of [field, field.footerToggle]) {
        const id = editableId(candidate)
        if (id) ids.add(id)
      }
    }
  }
  return ids
}
