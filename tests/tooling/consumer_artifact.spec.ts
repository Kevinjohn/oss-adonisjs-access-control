import { test } from '@japa/runner'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consumerArtifact } from '../../bin/helpers/consumer_artifact.js'

test.group('consumer archive snapshot', () => {
  test('keeps installed bytes after the supplied archive is replaced', ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_snapshot_test_'))
    const source = join(root, 'external.tgz')
    writeFileSync(source, 'original archive')
    try {
      const snapshot = consumerArtifact(root, source)
      try {
        writeFileSync(source, 'replacement archive')
        assert.equal(readFileSync(snapshot.path, 'utf8'), 'original archive')
      } finally {
        snapshot.cleanup()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses overlapping default builds and releases the lock after failure', ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'consumer_build_test_'))
    mkdirSync(join(root, 'tmp'))
    try {
      const first = consumerArtifact(root, undefined, (_cwd, args) => {
        if (args[0] === 'pack') writeFileSync(args[2], 'archive')
      })
      try {
        assert.throws(
          () => consumerArtifact(root, undefined, () => assert.fail('overlapping build ran')),
          /Another default consumer build/
        )
      } finally {
        first.cleanup()
      }
      assert.throws(
        () =>
          consumerArtifact(root, undefined, () => {
            throw new Error('build failed')
          }),
        /build failed/
      )
      const retry = consumerArtifact(root, undefined, (_cwd, args) => {
        if (args[0] === 'pack') writeFileSync(args[2], 'retry archive')
      })
      retry.cleanup()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
