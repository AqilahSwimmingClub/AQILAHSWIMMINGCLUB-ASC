// Aturan penghapusan permanen dan penggabungan data AQILAH Swimming Club.
//
// Modul ini sengaja murni (tanpa DOM, tanpa Supabase, tanpa localStorage) supaya
// seluruh aturan "data yang sudah dihapus tidak boleh hidup kembali" dapat diuji
// otomatis lewat `npm test`. main.js memakai fungsi yang sama persis, sehingga
// perilaku aplikasi dan perilaku yang diuji tidak pernah berbeda.

// Serialisasi stabil: urutan kunci object tidak memengaruhi hasilnya, sehingga
// dua perangkat menghasilkan sidik jari yang sama untuk isi yang sama.
export function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(',')}}`
}

// FNV-1a 32-bit. Cukup untuk membedakan record dan, yang terpenting, memberi
// hasil yang sama persis di semua perangkat tanpa dependensi tambahan.
function sidikJari(teks) {
  let h = 0x811c9dc5
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(7, '0')
}

// Kunci identitas alami sebuah record, atau '' bila record itu benar-benar tidak
// punya penanda yang dikenali. Dipisahkan supaya pemanggil dapat membedakan
// "punya ID" dari "tidak punya ID" tanpa menebak.
export function naturalIdentity(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item.id || item.paymentId || item.registrationId || item.invoiceId ||
    item.athleteId && item.date && `${item.athleteId}|${item.date}|${item.type || item.stroke || ''}` ||
    item.athleteId && item.month && `${item.athleteId}|${item.month}|${item.paymentType || ''}` ||
    item.coachId && item.period && `${item.coachId}|${item.period}` || '')
}

// Kunci identitas sebuah record. Dipakai untuk menggabungkan data maupun untuk
// mencocokkan nisan penghapusan.
//
// Aturan penting: fungsi ini TIDAK PERNAH mengembalikan string kosong. Dulu
// setiap record tanpa ID memakai kunci '' yang sama, sehingga beberapa record
// berbeda saling menimpa di mergeCollection() dan datanya hilang diam-diam.
// Sekarang record tanpa ID memperoleh sidik jari dari ISINYA, sehingga:
//   - dua record berbeda tetap menjadi dua record;
//   - record yang sama dikenali sebagai record yang sama walau urutan
//     arraynya berubah antarproses sinkronisasi.
export function recordIdentity(item, index = 0) {
  if (item && typeof item === 'object') {
    const alami = naturalIdentity(item)
    if (alami) return alami
    return `anon:${sidikJari(stableSerialize(item))}`
  }
  // Nilai primitif (bukan object) tetap dibedakan berdasarkan isinya.
  return `anon:${sidikJari(`${typeof item}:${JSON.stringify(item) ?? String(item)}`)}`
}

// Identitas yang menyertakan nomor kemunculan, untuk record tanpa ID yang isinya
// benar-benar sama persis. Tanpa ini, dua baris kembar akan menyusut jadi satu.
// Record yang punya ID tidak pernah diberi akhiran, sehingga penggabungan
// berdasarkan ID tetap bekerja seperti biasa.
export function identityWithOccurrence(item, index, penghitung) {
  const dasar = recordIdentity(item, index)
  if (naturalIdentity(item)) return dasar
  const ke = (penghitung.get(dasar) || 0) + 1
  penghitung.set(dasar, ke)
  return ke === 1 ? dasar : `${dasar}#${ke}`
}

// Migrasi record operasional lama yang belum punya ID menjadi ID stabil.
// ID-nya diturunkan dari isi record, jadi perangkat mana pun yang memigrasikan
// record yang sama menghasilkan ID yang sama — tidak ada duplikat saat sinkron.
// ID lama yang sudah valid TIDAK PERNAH diubah.
export function ensureRecordIds(list, { prefix = 'REC' } = {}) {
  if (!Array.isArray(list)) return []
  const terpakai = new Set()
  list.forEach(item => {
    const id = item && typeof item === 'object' ? String(item.id || '') : ''
    if (id) terpakai.add(id)
  })
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') return item
    if (String(item.id || '')) return item
    // Bila record sudah punya identitas alami (mis. athleteId|tanggal|jenis),
    // identitas itulah yang dipakai sebagai ID. Dengan begitu migrasi tidak
    // mengubah cara record dicocokkan: perangkat yang sudah bermigrasi dan yang
    // belum tetap menghasilkan kunci yang sama, jadi tidak muncul duplikat.
    const alami = naturalIdentity(item)
    const dasar = alami || `${prefix}-${sidikJari(stableSerialize(item))}`
    let id = dasar
    let ke = 1
    // Record kembar persis tetap mendapat ID berbeda, tanpa memakai posisi array
    // sebagai satu-satunya pembeda.
    while (terpakai.has(id)) id = `${dasar}-${++ke}`
    terpakai.add(id)
    return { ...item, id }
  })
}

export function tombstonesFor(collection, source) {
  const graves = source?.[collection]
  return graves && typeof graves === 'object' ? graves : {}
}

export function isTombstoned(collection, id, source) {
  return Boolean(tombstonesFor(collection, source)[String(id)])
}

// Nisan baru selalu dibuat dalam keadaan BELUM tersinkron. `syncedAt` hanya diisi
// setelah Supabase benar-benar menerima penghapusannya, sehingga penghapusan yang
// gagal terkirim akan dicoba ulang, bukan hilang diam-diam.
export function createTombstone({ clientId = '', actor = '', deletedAt = new Date().toISOString() } = {}) {
  return { deletedAt, clientId, actor, syncedAt: '' }
}

export function markTombstone(tombstones, collection, id, meta = {}) {
  const map = tombstones && typeof tombstones === 'object' ? tombstones : {}
  map[collection] ||= {}
  map[collection][String(id)] = createTombstone(meta)
  return map
}

export function clearTombstone(tombstones, collection, id) {
  const graves = tombstones?.[collection]
  if (graves) delete graves[String(id)]
  return tombstones
}

// Nisan dari beberapa sumber (perangkat ini, cache lama, payload Supabase)
// digabungkan. Nisan tidak pernah dibatalkan oleh sumber lain yang belum tahu
// tentang penghapusan tersebut — sekali dihapus, tetap terhapus.
export function mergeTombstoneMaps(...sources) {
  const merged = {}
  sources.forEach(source => {
    if (!source || typeof source !== 'object') return
    Object.entries(source).forEach(([collection, graves]) => {
      if (!graves || typeof graves !== 'object') return
      const target = merged[collection] ||= {}
      Object.entries(graves).forEach(([id, grave]) => {
        const existing = target[id]
        if (!existing) { target[id] = grave; return }
        // Status "sudah tersinkron" menang, dan waktu hapus paling awal dipertahankan.
        target[id] = {
          ...existing,
          ...grave,
          deletedAt: [existing.deletedAt, grave?.deletedAt].filter(Boolean).sort()[0] || '',
          syncedAt: existing.syncedAt || grave?.syncedAt || ''
        }
      })
    })
  })
  return merged
}

// Penyaring tunggal: daftar apa pun (cache lokal, payload legacy, hasil tabel
// Supabase, atau kiriman realtime) harus melewati fungsi ini sebelum masuk state.
export function withoutTombstoned(collection, list, tombstones) {
  const graves = tombstonesFor(collection, tombstones)
  if (!Array.isArray(list) || !Object.keys(graves).length) return list
  return list.filter((item, index) => {
    const id = String(item?.id || '')
    // Kunci kosong tidak pernah dicari: sebuah nisan '' akan menghapus SELURUH
    // record yang belum punya ID.
    if (id && graves[id]) return false
    return !graves[recordIdentity(item, index)]
  })
}

// ID yang sudah bernisan tetapi masih hidup di sumber data. Penghapusannya belum
// sampai ke Supabase, jadi aplikasi harus mengirim ulang perintah hapusnya.
export function resurrectedIds(collection, remoteList, tombstones) {
  const graves = tombstonesFor(collection, tombstones)
  if (!Array.isArray(remoteList) || !Object.keys(graves).length) return []
  const ids = new Set()
  remoteList.forEach((item, index) => {
    const id = String(item?.id || '')
    if (id && graves[id]) ids.add(id)
    const identity = recordIdentity(item, index)
    if (identity && graves[identity]) ids.add(identity)
  })
  return [...ids]
}

// Nisan yang belum dikonfirmasi Supabase, untuk dikirim ulang saat sinkronisasi.
export function pendingTombstoneIds(collection, tombstones) {
  return Object.entries(tombstonesFor(collection, tombstones))
    .filter(([, grave]) => !grave?.syncedAt)
    .map(([id]) => id)
}

export function markTombstoneSynced(tombstones, collection, id, syncedAt = new Date().toISOString()) {
  const grave = tombstones?.[collection]?.[String(id)]
  if (grave && typeof grave === 'object') grave.syncedAt = syncedAt
  return tombstones
}

// Membuang seluruh record bernisan dari sebuah state/payload, untuk semua koleksi
// yang punya nisan. Dipakai sebelum menyimpan ke Supabase dan setelah memuat data.
export function purgeTombstoned(target, tombstones = target?.__tombstones) {
  if (!target || typeof target !== 'object') return target
  if (!tombstones || typeof tombstones !== 'object') return target
  Object.keys(tombstones).forEach(collection => {
    const list = target[collection]
    if (!Array.isArray(list) || !list.length) return
    const kept = withoutTombstoned(collection, list, tombstones)
    if (kept.length !== list.length) target[collection] = kept
  })
  return target
}

export function mergeCollection(remoteList = [], localList = [], tombstones = {}) {
  const merged = new Map()
  // Penghitung kemunculan dihitung terpisah untuk tiap sisi, sehingga baris
  // kembar ke-2 di server dipasangkan dengan baris kembar ke-2 di perangkat.
  const hitungRemote = new Map()
  const hitungLocal = new Map()
  ;(Array.isArray(remoteList) ? remoteList : []).forEach((item, index) => {
    const key = identityWithOccurrence(item, index, hitungRemote)
    if (!tombstones[key] && !tombstones[recordIdentity(item, index)]) merged.set(key, structuredClone(item))
  })
  ;(Array.isArray(localList) ? localList : []).forEach((item, index) => {
    const key = identityWithOccurrence(item, index, hitungLocal)
    if (tombstones[key] || tombstones[recordIdentity(item, index)]) return
    const old = merged.get(key)
    merged.set(key, old && typeof old === 'object' && typeof item === 'object'
      ? { ...old, ...structuredClone(item) }
      : structuredClone(item))
  })
  return [...merged.values()]
}

export function mergeStateWithoutLoss(remotePayload, localPayload, {
  defaultState = {},
  persistentCollections = [],
  clientId = '',
  savedAt = new Date().toISOString()
} = {}) {
  const remote = remotePayload && typeof remotePayload === 'object' ? remotePayload : {}
  const local = localPayload && typeof localPayload === 'object' ? localPayload : {}
  const merged = { ...structuredClone(defaultState), ...structuredClone(remote), ...structuredClone(local) }
  merged.__tombstones = mergeTombstoneMaps(remote.__tombstones, local.__tombstones)
  persistentCollections.forEach(key => {
    merged[key] = mergeCollection(remote[key], local[key], merged.__tombstones[key] || {})
  })
  merged.settings = { ...(remote.settings || {}), ...(local.settings || {}) }
  merged.parentReminders = { ...(remote.parentReminders || {}), ...(local.parentReminders || {}) }
  merged.__sync = { ...(remote.__sync || {}), ...(local.__sync || {}), clientId, savedAt }
  // Payload yang dikirim ke Supabase tidak boleh lagi memuat record bernisan,
  // supaya salinan legacy berhenti menjadi sumber data yang bangkit kembali.
  return purgeTombstoned(merged)
}

// Memilih daftar yang benar untuk satu koleksi saat memuat dari Supabase.
// Semua jalur — tabel khusus, fallback payload legacy, dan cache perangkat —
// disaring nisan lebih dulu.
export function resolveCollectionFromSources(collection, {
  remoteItems = [],
  remoteError = null,
  remoteTotalCount = null,
  legacyFallback = [],
  deviceItems = [],
  tombstones = {}
} = {}) {
  const items = withoutTombstoned(collection, Array.isArray(remoteItems) ? remoteItems : [], tombstones) || []
  if (!remoteError && items.length) return items
  // Tabel benar-benar kosong (bukan gagal dibaca): itu jawaban yang sah.
  if (!remoteError && Number(remoteTotalCount) > 0) return []
  const safeFallback = withoutTombstoned(collection, Array.isArray(legacyFallback) ? legacyFallback : [], tombstones) || []
  // Payload legacy sering memuat duplikat ID; ambil satu saja per ID, tetapi
  // record lama tanpa ID tidak ikut dibuang.
  const seen = new Map()
  const uniqueFallback = []
  safeFallback.forEach(item => {
    const id = String(item?.id || '')
    if (!id) { uniqueFallback.push(item); return }
    if (seen.has(id)) { uniqueFallback[seen.get(id)] = item; return }
    seen.set(id, uniqueFallback.length)
    uniqueFallback.push(item)
  })
  if (uniqueFallback.length) return uniqueFallback
  // Tabel gagal dibaca dan fallback kosong: pertahankan data perangkat apa adanya
  // (tetap disaring nisan) supaya gangguan jaringan tidak menghapus data.
  return withoutTombstoned(collection, Array.isArray(deviceItems) ? deviceItems : [], tombstones) || []
}

// ---------------------------------------------------------------------------
// Penulisan nisan ke sumber data.
//
// Alurnya murni dan menerima operasi penyimpanan sebagai parameter, sehingga
// aturannya dapat diuji tanpa Supabase. Aturan utamanya satu: nisan HANYA boleh
// ditandai tersinkron bila sumber data benar-benar menerima penghapusannya.
// ---------------------------------------------------------------------------

export class TombstoneWriteError extends Error {
  constructor(collection, id, message) {
    super(`Penghapusan belum tersinkron ke Supabase dan akan dicoba ulang. ${message}`)
    this.name = 'TombstoneWriteError'
    this.collection = collection
    this.recordId = String(id)
  }
}

export async function commitTombstone(collection, id, {
  // async (deletedAt) => { rows: <jumlah baris yang ter-update>, error }
  updateDeletedAt,
  // async (deletedAt) => { error } — dipakai bila UPDATE tidak menemukan baris
  insertTombstoneRow,
  tombstones = {},
  queueRetry = () => {},
  deletedAt = new Date().toISOString()
} = {}) {
  const updated = await updateDeletedAt(deletedAt)
  if (updated?.error) {
    // Penghapusan tidak boleh hilang diam-diam: antrean retry dulu, baru gagal.
    queueRetry(collection, id)
    throw new TombstoneWriteError(collection, id, String(updated.error?.message || updated.error))
  }
  if (!Number(updated?.rows || 0)) {
    // Record belum pernah punya baris di tabelnya (hanya hidup di payload
    // legacy), jadi UPDATE mengenai nol baris. Baris nisan dibuat agar
    // perangkat lain ikut melihatnya terhapus.
    const inserted = await insertTombstoneRow(deletedAt)
    if (inserted?.error) {
      // Supabase belum mencatat penghapusan ini. Menandainya "tersinkron" akan
      // menghentikan retry dan membiarkan record hidup kembali di perangkat lain.
      queueRetry(collection, id)
      throw new TombstoneWriteError(collection, id, String(inserted.error?.message || inserted.error))
    }
  }
  markTombstoneSynced(tombstones, collection, id, deletedAt)
  return true
}

// ---------------------------------------------------------------------------
// Pengalokasian ID yang aman terhadap nisan penghapusan.
//
// ID yang pernah dihapus TIDAK BOLEH dipakai ulang. Bila dipakai ulang, record
// baru akan ditolak refuseTombstonedWrite(), atau ikut tersapu saat perangkat
// lain menyinkronkan nisannya — record baru hilang tanpa jejak.
// ---------------------------------------------------------------------------

// Nomor urut berikutnya yang belum pernah dipakai DAN belum pernah bernisan.
// Dipakai untuk ID berpola seperti ASC-0001 dan PLT-0001.
export function nextSequentialId(collection, {
  prefix,
  pad = 4,
  existingIds = [],
  tombstones = {},
  monotonic = true
} = {}) {
  const graves = tombstonesFor(collection, tombstones)
  const angkaDari = nilai => {
    const teks = String(nilai || '')
    if (!teks.startsWith(`${prefix}-`)) return NaN
    const angka = Number(teks.slice(prefix.length + 1).replace(/\D/g, ''))
    return Number.isFinite(angka) ? angka : NaN
  }
  const terpakai = new Set()
  existingIds.forEach(id => { const n = angkaDari(id); if (Number.isFinite(n)) terpakai.add(n) })
  // Nomor yang pernah dihapus ikut dianggap terpakai selamanya.
  Object.keys(graves).forEach(id => { const n = angkaDari(id); if (Number.isFinite(n)) terpakai.add(n) })

  const buat = n => `${prefix}-${String(n).padStart(pad, '0')}`
  if (monotonic) {
    // Selalu naik: tidak pernah mundur ke nomor yang sempat kosong.
    const tertinggi = terpakai.size ? Math.max(...terpakai) : 0
    return buat(tertinggi + 1)
  }
  let n = 1
  while (terpakai.has(n)) n++
  return buat(n)
}

// ID deterministik (mis. FIN-income-payment-PAY1 atau NTF-...) dipakai ulang
// dengan sengaja ketika sebuah referensi dibuat kembali. Bila ID dasarnya sudah
// bernisan, record BARU harus memakai ID baru yang berbeda — bukan menghidupkan
// kembali record lama dengan membatalkan nisannya secara lokal.
export function nextAvailableDeterministicId(collection, baseId, tombstones = {}, batas = 500) {
  const graves = tombstonesFor(collection, tombstones)
  const dasar = String(baseId)
  if (!graves[dasar]) return dasar
  for (let revisi = 2; revisi <= batas; revisi++) {
    const kandidat = `${dasar}-r${revisi}`
    if (!graves[kandidat]) return kandidat
  }
  // Jalan terakhir yang tetap unik dan tidak pernah bertabrakan dengan nisan.
  return `${dasar}-r${Date.now()}`
}

// Apakah sebuah ID aman dipakai untuk record baru?
export function isIdSafeForNewRecord(collection, id, tombstones = {}) {
  return !tombstonesFor(collection, tombstones)[String(id)]
}
