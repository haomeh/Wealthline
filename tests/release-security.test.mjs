import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const script=fileURLToPath(new URL('../scripts/verify-release.sh',import.meta.url))

test('install, advisory, signature, and test failures stop release verification',()=>{
  const dir=mkdtempSync(join(tmpdir(),'release-gate-'))
  const log=join(dir,'calls')
  const node=join(dir,'node')
  const npm=join(dir,'npm')
  try {
    writeFileSync(node,'#!/bin/sh\necho v22.22.1\n')
    writeFileSync(npm,'#!/bin/sh\nif [ "$1" = --version ]; then echo 10.9.4; exit 0; fi\necho "$*" >> "$CALL_LOG"\nif [ "$*" = "$FAIL_AT" ]; then exit 42; fi\n')
    chmodSync(node,0o755)
    chmodSync(npm,0o755)
    const commands=['ci --ignore-scripts --include=dev','audit --audit-level=high --include=dev','audit signatures','test']
    for (const [index,failAt] of commands.entries()) {
      writeFileSync(log,'')
      const result=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:`${dir}:${process.env.PATH}`,CALL_LOG:log,FAIL_AT:failAt}})
      assert.equal(result.status,42,`${failAt}: ${result.stderr}`)
      assert.deepEqual(readFileSync(log,'utf8').trim().split('\n'),commands.slice(0,index+1))
    }
  } finally {
    rmSync(dir,{recursive:true,force:true})
  }
})

test('workflow runs the checked gate on unprivileged pull requests',()=>{
  const workflow=readFileSync(fileURLToPath(new URL('../.github/workflows/verify.yml',import.meta.url)),'utf8')
  assert.match(workflow,/pull_request:\s*\n\s*branches: \[main\]/)
  assert.match(workflow,/permissions:\s*\n\s*contents: read/)
  assert.match(workflow,/persist-credentials: false/)
  assert.match(workflow,/run: bash scripts\/verify-release\.sh/)
  assert.doesNotMatch(workflow,/continue-on-error|pull_request_target|secrets\.|package-manager-cache/)
})
