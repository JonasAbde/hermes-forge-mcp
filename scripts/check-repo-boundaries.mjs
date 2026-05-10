#!/usr/bin/env node
/**
 * Forge Ecosystem — Repository Boundary Checker
 *
 * Verifies that no database dependencies have accidentally been added to
 * client repos (cli, mcp, chat). Run in CI or locally.
 *
 * Usage:
 *   node scripts/check-repo-boundaries.mjs              # strict mode (for client repos)
 *   node scripts/check-repo-boundaries.mjs --allow-db   # allow mode (for platform)
 *
 * Exit codes:
 *   0 — All clean
 *   1 — DB dependencies found (violation)
 *
 * OpenClaw Agent — 2026-05-10
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ALLOW_DB = process.argv.includes('--allow-db')

const FORBIDDEN_DEP_PATTERNS = [
  'better-sqlite3',
  'sqlite3',
  'libsql',
  'drizzle-orm',
  'drizzle-kit',
  'pg',
  'postgres',
  'prisma',
  '@prisma/client',
  'knex',
  'typeorm',
  'sequelize',
  'mongodb',
  'mongoose',
  'redis',
  'ioredis',
]

const FORBIDDEN_FILE_PATTERNS = [
  /drizzle\.config/,
  /schema\.prisma/,
  /forge-store/,
  /knexfile/,
  /database\.(js|ts|mjs)/,
]

function readdirRecursive(dir) {
  const results = []
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const s = statSync(fullPath)
      if (s.isDirectory()) {
        results.push(...readdirRecursive(fullPath))
      } else {
        results.push(fullPath)
      }
    }
  } catch {
    // skip unreadable or non-existent dirs
  }
  return results
}

function check() {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    console.log('✅ No package.json found — skipping (not a Node project)')
    process.exit(0)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]

  const repoName = pkg.name || relative(root, process.cwd())
  const modeLabel = ALLOW_DB ? 'allow-db mode' : 'strict mode'
  console.log(`\n🔍 Checking "${repoName}" for database dependencies (${modeLabel})...`)

  let violations = 0

  // 1. Check dependencies
  for (const dep of allDeps) {
    if (FORBIDDEN_DEP_PATTERNS.includes(dep)) {
      if (ALLOW_DB) {
        console.log(`  ℹ️  DB DEPENDENCY: "${dep}" (allowed by --allow-db)`)
      } else {
        console.log(`  ❌ FORBIDDEN DEPENDENCY: "${dep}" in package.json`)
        violations++
      }
    }
  }

  // 2. Check source files
  for (const dirName of ['src', 'server', 'lib', 'build']) {
    const dir = join(root, dirName)
    if (!existsSync(dir)) continue
    const entries = readdirRecursive(dir)
    for (const entry of entries) {
      const relPath = relative(root, entry)
      for (const pattern of FORBIDDEN_FILE_PATTERNS) {
        if (pattern.test(relPath)) {
          if (ALLOW_DB) {
            console.log(`  ℹ️  DB FILE: "${relPath}" (allowed by --allow-db)`)
          } else {
            console.log(`  ❌ FORBIDDEN FILE: "${relPath}" matches DB pattern`)
            violations++
          }
        }
      }
    }
  }

  // 3. Check top-level drizzle config
  for (const configFile of ['drizzle.config.mjs', 'drizzle.config.js', 'drizzle.config.ts']) {
    if (existsSync(join(root, configFile))) {
      if (ALLOW_DB) {
        console.log(`  ℹ️  DB CONFIG: "${configFile}" (allowed by --allow-db)`)
      } else {
        console.log(`  ❌ FORBIDDEN FILE: "${configFile}" — drizzle config not allowed in client repos`)
        violations++
      }
    }
  }

  if (violations === 0) {
    console.log(`  ✅ No database dependency violations found — boundaries respected`)
    process.exit(0)
  } else {
    console.log(`\n  ❌ ${violations} boundary violation(s) detected!`)
    console.log('  Only hermes-forge-platform may contain database dependencies.')
    console.log('  See: docs/ARCHITECTURE.md → Repository Boundaries')
    process.exit(1)
  }
}

check()
