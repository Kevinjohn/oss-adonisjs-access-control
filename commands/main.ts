/**
 * Ace command discovery loader for `adonisrc.ts`. `access-control:doctor` arrives with the
 * configure milestone; until then no command is listed.
 */
export async function getMetaData(): Promise<CommandMetadata[]> {
  return []
}

/** Resolves a listed command class by the same contract AdonisJS core uses. */
export async function getCommand(metaData: CommandMetadata): Promise<null> {
  void metaData
  return null
}

/** Serialized command metadata, as produced by `BaseCommand.serialize()`. */
export interface CommandMetadata {
  commandName: string
  [key: string]: unknown
}
