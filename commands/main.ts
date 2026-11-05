/**
 * Ace command discovery loader for `adonisrc.ts`: lists `access-control:doctor`.
 */
import { ListLoader } from '@adonisjs/core/ace'
import AccessControlDoctor from './doctor.js'

const loader = new ListLoader([AccessControlDoctor])

export { AccessControlDoctor }

/** Serialized metadata of every package command, for Ace's discovery. */
export const getMetaData = loader.getMetaData.bind(loader)
/** Resolves a listed command class by the same contract AdonisJS core uses. */
export const getCommand = loader.getCommand.bind(loader)
