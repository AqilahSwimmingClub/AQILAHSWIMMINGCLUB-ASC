// Aturan penghapusan permanen dan penggabungan data AQILAH Swimming Club.
//
// Modul ini sengaja murni (tanpa DOM, tanpa Supabase, tanpa localStorage) supaya
// seluruh aturan "data yang sudah dihapus tidak boleh hidup kembali" dapat diuji
// otomatis lewat `npm test`. main.js memakai fungsi yang sama persis, sehingga
// perilaku aplikasi dan perilaku yang diuji tidak pernah berbeda.

// Kunci identitas sebuah record. Dipakai baik untuk menggabungkan data maupun
// untuk mencocokkan nisan penghapusan.
export function recordIdentity(item, index = 0) {
  if (item && typeof item === 'object') {
    return String(item.id || item.paymentId || item.registrationId || item.invoiceId ||
      item.athleteId && item.date && `${item.athleteId}|${item.date}|${item.type || item.stroke || ''}` ||
      item.athleteId && item.month && `${item.athleteId}|${item.month}|${item.paymentType || ''}` ||
      item.coachId && item.period && `${item.coachId}|${item.period}` || '')
  }
  return `index-${index}-${JSON.stringify(item)}`
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
  return list.filter((item, index) => !graves[String(item?.id || '')] && !graves[recordIdentity(item, index)])
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
  ;(Array.isArray(remoteList) ? remoteList : []).forEach((item, index) => {
    const key = recordIdentity(item, index)
    if (!tombstones[key]) merged.set(key, structuredClone(item))
  })
  ;(Array.isArray(localList) ? localList : []).forEach((item, index) => {
    const key = recordIdentity(item, index)
    if (tombstones[key]) return
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
