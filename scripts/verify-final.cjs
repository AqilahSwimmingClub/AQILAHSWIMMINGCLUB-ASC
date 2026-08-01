const fs=require('fs')
const path=require('path')
const root=path.resolve(__dirname,'..')
const main=fs.readFileSync(path.join(root,'src','main.js'),'utf8')
const required=[
  ['merge-before-save','mergeStateWithoutLoss'],
  ['verification-after-save','verifyCriticalCollections'],
  ['recovery-journal','appendRecoveryJournal'],
  ['unique-storage-path','createId()}-${safeFilePart'],
  ['tombstone-delete','function softDelete'],
  ['audit-trail','function addAudit'],
  ['version-history','function addVersionSnapshot'],
  ['recovery-center','restoreLatestSafetySnapshot'],
  ['manual-sync','syncNow'],
  ['backup-download','downloadFullBackup']
]
let failed=0
for(const [name,needle] of required){
  const ok=main.includes(needle)
  console.log(`${ok?'PASS':'FAIL'} ${name}`)
  if(!ok)failed++
}
const directCriticalDeletes=[
  /state\.athletes\s*=\s*state\.athletes\.filter/,
  /state\.timeRecords\s*=\s*state\.timeRecords\.filter/,
  /state\.payments\s*=\s*state\.payments\.filter/,
  /state\.coachSalaries\s*=\s*state\.coachSalaries\.filter/
]
for(const pattern of directCriticalDeletes){
  const ok=!pattern.test(main)
  console.log(`${ok?'PASS':'FAIL'} no-direct-critical-delete ${pattern}`)
  if(!ok)failed++
}
if(failed){console.error(`Verification failed: ${failed}`);process.exit(1)}
console.log('Static final verification passed.')
