import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const bundlePath = fileURLToPath(new URL('../dist/build/index.mjs', import.meta.url))
const bundle = readFileSync(bundlePath, 'utf8')

const forbiddenPatterns = ['@repo/', 'workspace:*', 'packages/domain']

const violations = forbiddenPatterns.filter((pattern) => bundle.includes(pattern))

if (violations.length > 0) {
  console.error(`Bundle verification failed: ${bundlePath}`)
  for (const pattern of violations) {
    console.error(`  Found forbidden pattern: ${pattern}`)
  }
  process.exit(1)
}

console.log(`Bundle OK: no workspace imports in ${path.basename(bundlePath)}`)
