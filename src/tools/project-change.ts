type ProjectChangeInput = {
  readonly projectPid: string | undefined
  readonly name: string | undefined
  readonly slug: string | undefined
  readonly description: string | undefined
  readonly domainName: string | undefined
}

export type ProjectChange =
  | {
      readonly kind: 'create'
      readonly payload: { name: string; slug: string; description?: string }
    }
  | {
      readonly kind: 'edit'
      readonly projectPid: string
      readonly payload: { name?: string; description?: string | null }
    }
  | { readonly kind: 'none' }

/**
 * Decides what `air_create_project` does before any API call, so a bad
 * combination fails without renaming the domain first.
 */
export const planProjectChange = (input: ProjectChangeInput): ProjectChange => {
  if (input.projectPid !== undefined) {
    if (input.slug !== undefined) {
      throw new Error('A project slug cannot change. Leave slug out when you pass projectPid.')
    }
    if (input.name === undefined && input.description === undefined) {
      throw new Error('Pass a new name or description to edit the project.')
    }
    return {
      kind: 'edit',
      projectPid: input.projectPid,
      payload: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined
          ? {}
          : { description: input.description.length === 0 ? null : input.description }),
      },
    }
  }

  if (input.name !== undefined || input.slug !== undefined || input.description !== undefined) {
    if (input.name === undefined || input.slug === undefined) {
      throw new Error('To create a project, pass both name and slug.')
    }
    return {
      kind: 'create',
      payload: {
        name: input.name,
        slug: input.slug,
        ...(input.description === undefined ? {} : { description: input.description }),
      },
    }
  }

  if (input.domainName === undefined) {
    throw new Error(
      'Nothing to change. Pass name and slug to create a project, projectPid to edit one, or domainName to rename the domain.',
    )
  }
  return { kind: 'none' }
}
