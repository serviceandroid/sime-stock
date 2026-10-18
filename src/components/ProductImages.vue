<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'

const props = defineProps<{
  productId: string
  productName: string
}>()

const emit = defineEmits<{
  'busy-change': [value: boolean]
}>()

type ProductImage = {
  id: string
  storage_path: string
  alt_text: string | null
  is_primary: boolean
  sort_order: number
}

type ImagePreview = ProductImage & {
  url: string | null
}

const bucket = 'product-images'
const pageSize = 6
const maxFileSize = 5 * 1024 * 1024

const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const caption = ref('')
const photos = ref<ImagePreview[]>([])
const page = ref(1)
const total = ref(0)

const busy = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const previewWarning = ref('')

let disposed = false

const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
)

const rangeStart = computed(() =>
  total.value === 0 ? 0 : (page.value - 1) * pageSize + 1,
)

const rangeEnd = computed(() =>
  Math.min(page.value * pageSize, total.value),
)

function message(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return fallback
}

function setBusy(value: boolean) {
  busy.value = value
  if (!disposed) emit('busy-change', value)
}

function clearMessages() {
  errorMessage.value = ''
  successMessage.value = ''
}

function releasePreviews(items: ImagePreview[]) {
  for (const item of items) {
    if (item.url) URL.revokeObjectURL(item.url)
  }
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
  clearMessages()
}

// Cette fonction est aussi appelée pendant un ajout ou une suppression.
// Le verrou est géré par la fonction appelante.
async function fetchPhotos(targetPage = page.value) {
  previewWarning.value = ''
  let requestedPage = Math.max(1, targetPage)

  while (true) {
    const start = (requestedPage - 1) * pageSize

    const { data, error, count } = await supabase
      .from('product_images')
      .select(
        'id, storage_path, alt_text, is_primary, sort_order',
        { count: 'exact' },
      )
      .eq('product_id', props.productId)
      .order('is_primary', { ascending: false })
      .order('sort_order')
      .order('created_at')
      .order('id')
      .range(start, start + pageSize - 1)

    if (error) throw error
    if (!data || count === null) {
      throw new Error('Réponse incomplète pour les photos.')
    }

    const lastPage = Math.max(1, Math.ceil(count / pageSize))

    if (requestedPage > lastPage) {
      requestedPage = lastPage
      continue
    }

    const previews: ImagePreview[] = await Promise.all(
      (data as ProductImage[]).map(async (photo) => {
        try {
          const { data: blob, error: downloadError } = await supabase
            .storage
            .from(bucket)
            .download(photo.storage_path)

          if (downloadError || !blob) {
            return { ...photo, url: null }
          }

          return { ...photo, url: URL.createObjectURL(blob) }
        } catch {
          return { ...photo, url: null }
        }
      }),
    )

    if (disposed) {
      releasePreviews(previews)
      return
    }

    releasePreviews(photos.value)
    photos.value = previews
    total.value = count
    page.value = requestedPage

    if (previews.some((photo) => !photo.url)) {
      previewWarning.value =
        'Certaines photos n’ont pas pu être chargées. Cliquez sur Actualiser pour réessayer.'
    }

    return
  }
}

async function loadPhotos(targetPage = page.value) {
  if (busy.value) return

  setBusy(true)
  errorMessage.value = ''

  try {
    await fetchPhotos(targetPage)
  } catch (error) {
    errorMessage.value = message(
      error,
      'Impossible de charger les photos.',
    )
  } finally {
    setBusy(false)
  }
}

async function uploadPhoto() {
  if (busy.value) return
  clearMessages()

  const file = selectedFile.value

  if (!file) {
    errorMessage.value = 'Sélectionnez une photo.'
    return
  }

  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }

  const extension = extensions[file.type]

  if (!extension) {
    errorMessage.value =
      'Utilisez une image JPG, PNG ou WebP.'
    return
  }

  if (file.size === 0 || file.size > maxFileSize) {
    errorMessage.value =
      'La photo doit faire au maximum 5 Mo et ne doit pas être vide.'
    return
  }

  setBusy(true)

  const imageId = crypto.randomUUID()
  const storagePath = `${props.productId}/${imageId}.${extension}`
  let registered = false

  try {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) throw uploadError

    const { error: insertError } = await supabase
      .from('product_images')
      .insert({
        id: imageId,
        product_id: props.productId,
        storage_path: storagePath,
        alt_text: caption.value.trim() || null,
        is_primary: false,
        sort_order: 0,
      })

    if (insertError) {
      // Une réponse réseau perdue ne signifie pas forcément
      // que l’enregistrement a échoué.
      const { data: existing, error: checkError } = await supabase
        .from('product_images')
        .select('id')
        .eq('id', imageId)
        .eq('product_id', props.productId)
        .maybeSingle()

      if (checkError) {
        throw new Error(
          'La confirmation de l’ajout est indisponible. Actualisez les photos avant de réessayer.',
        )
      }

      if (!existing) {
        // Le fichier sans fiche peut être nettoyé.
        const { error: cleanupError } = await supabase.storage
          .from(bucket)
          .remove([storagePath])

        if (cleanupError) {
          throw new Error(
            'La photo n’a pas pu être associée au produit. Un fichier non associé reste dans le stockage ; signalez-le au développeur.',
          )
        }

        throw insertError
      }
    }

    registered = true
    selectedFile.value = null
    caption.value = ''
    if (fileInput.value) fileInput.value.value = ''

    successMessage.value =
      'Photo ajoutée. Vous pouvez la définir comme photo principale.'

    await fetchPhotos(1)
  } catch (error) {
    errorMessage.value = registered
      ? 'La photo est enregistrée, mais la liste n’a pas pu être actualisée. Cliquez sur Actualiser.'
      : message(error, 'Impossible d’ajouter la photo.')
  } finally {
    setBusy(false)
  }
}

async function makePrimary(photo: ImagePreview) {
  if (busy.value || photo.is_primary) return
  clearMessages()
  setBusy(true)

  let updated = false

  try {
    const { error } = await supabase.rpc(
      'set_product_primary_image',
      {
        p_product_id: props.productId,
        p_image_id: photo.id,
      },
    )

    if (error) throw error

    updated = true
    successMessage.value = 'La photo principale a été mise à jour.'
    await fetchPhotos(1)
  } catch (error) {
    errorMessage.value = updated
      ? 'La photo principale a été changée. Cliquez sur Actualiser pour recharger les aperçus.'
      : message(
          error,
          'Impossible de changer la photo principale. Actualisez pour vérifier le résultat avant de réessayer.',
        )
  } finally {
    setBusy(false)
  }
}

async function deletePhoto(photo: ImagePreview) {
  if (busy.value) return

  if (
    !window.confirm(
      `Supprimer cette photo de « ${props.productName} » ?${
        photo.is_primary
          ? '\nVous devrez choisir une nouvelle photo principale.'
          : ''
      }`,
    )
  ) {
    return
  }

  clearMessages()
  setBusy(true)
  let deleted = false

  try {
    // Retire d’abord la fiche. Si le stockage échoue ensuite,
    // aucune fiche ne pointera vers un fichier supprimé.
    const { data, error } = await supabase
      .from('product_images')
      .delete()
      .eq('id', photo.id)
      .eq('product_id', props.productId)
      .select('id')
      .maybeSingle()

    if (error) throw error

    deleted = true

    const { error: storageError } = await supabase.storage
      .from(bucket)
      .remove([photo.storage_path])

    successMessage.value = data
      ? 'La photo a été supprimée de la fiche.'
      : 'Cette photo avait déjà été retirée de la fiche.'

    if (storageError) {
      errorMessage.value =
        'La photo est retirée de la fiche, mais son fichier reste dans le stockage. Signalez-le au développeur pour le nettoyage.'
    }

    await fetchPhotos(page.value)
  } catch (error) {
    errorMessage.value = deleted
      ? 'La photo est retirée de la fiche. Actualisez la liste ; le nettoyage du fichier peut rester à vérifier.'
      : message(
          error,
          'Impossible de confirmer la suppression. Actualisez les photos pour vérifier le résultat.',
        )
  } finally {
    setBusy(false)
  }
}

onMounted(() => loadPhotos(1))

onBeforeUnmount(() => {
  disposed = true
  releasePreviews(photos.value)
})
</script>

<template>
  <section class="images-panel" aria-labelledby="images-title">
    <header class="panel-header">
      <div>
        <h2 id="images-title">Photos : {{ productName }}</h2>
        <p class="help">
          Ajoutez les photos du produit, puis choisissez celle à mettre
          en avant dans le catalogue.
        </p>
      </div>

      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="loadPhotos()"
      >
        Actualiser
      </button>
    </header>

    <form class="upload-form" @submit.prevent="uploadPhoto">
      <div class="field">
        <label for="product-photo">Photo *</label>
        <input
          id="product-photo"
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :disabled="busy"
          required
          @change="selectFile"
        />
        <span class="help">JPG, PNG ou WebP · 5 Mo maximum</span>
      </div>

      <div class="field">
        <label for="photo-caption">Description — facultative</label>
        <input
          id="photo-caption"
          v-model="caption"
          type="text"
          placeholder="Ex. Bidon de nettoyant, vue de face"
          :disabled="busy"
        />
      </div>

      <button
        type="submit"
        :disabled="busy || !selectedFile"
      >
        {{ busy ? 'Opération en cours…' : 'Ajouter la photo' }}
      </button>
    </form>

    <p v-if="successMessage" class="success" role="status">
      {{ successMessage }}
    </p>

    <p v-if="errorMessage" class="error" role="alert">
      {{ errorMessage }}
    </p>

    <p v-if="previewWarning" class="warning" role="status">
      {{ previewWarning }}
    </p>

    <p v-if="busy" class="help" role="status">
      Opération en cours…
    </p>

    <p v-if="!busy && !errorMessage && total === 0" class="help">
      Aucune photo pour ce produit.
    </p>

    <div v-if="photos.length" class="photo-grid">
      <article
        v-for="photo in photos"
        :key="photo.id"
        class="photo-card"
      >
        <div class="preview">
          <img
            v-if="photo.url"
            :src="photo.url"
            :alt="photo.alt_text || productName"
          />
          <span v-else>Aperçu indisponible</span>
        </div>

        <div class="photo-content">
          <span v-if="photo.is_primary" class="primary-badge">
            Photo principale
          </span>

          <p class="caption">
            {{ photo.alt_text || 'Sans description' }}
          </p>

          <div class="photo-actions">
            <button
              type="button"
              class="secondary"
              :disabled="busy || photo.is_primary"
              @click="makePrimary(photo)"
            >
              {{
                photo.is_primary
                  ? 'Photo principale'
                  : 'Définir comme principale'
              }}
            </button>

            <button
              type="button"
              class="danger"
              :disabled="busy"
              :aria-label="`Supprimer la photo ${
                photo.alt_text || 'de ' + productName
              }`"
              @click="deletePhoto(photo)"
            >
              Supprimer
            </button>
          </div>
        </div>
      </article>
    </div>

    <nav
      v-if="total > 0"
      class="pagination"
      aria-label="Pages des photos"
    >
      <span class="help">
        {{ rangeStart }}–{{ rangeEnd }} sur {{ total }}
        · Page {{ page }} / {{ pageCount }}
      </span>

      <div class="pagination-actions">
        <button
          type="button"
          class="secondary"
          :disabled="busy || page <= 1"
          @click="loadPhotos(page - 1)"
        >
          Précédent
        </button>

        <button
          type="button"
          class="secondary"
          :disabled="busy || page >= pageCount"
          @click="loadPhotos(page + 1)"
        >
          Suivant
        </button>
      </div>
    </nav>
  </section>
</template>

<style scoped>
.images-panel {
  min-width: 0;
  padding: 26px;
  border: 1px solid #e0e7ef;
  border-radius: 16px;
  color: #172b42;
  background: #fff;
}

.panel-header,
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.panel-header {
  align-items: flex-start;
}

.panel-header > div {
  flex: 1 1 240px;
  min-width: 0;
}

h2 {
  margin: 0;
  font-size: 21px;
  overflow-wrap: anywhere;
}

.help {
  color: #586a7d;
  font-size: 14px;
  line-height: 1.6;
}

.upload-form {
  display: grid;
  gap: 18px;
  margin: 20px 0;
  padding: 20px;
  border: 1px solid #dbe5ef;
  border-radius: 12px;
  background: #f5f9fd;
}

.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

label {
  font-size: 14px;
  font-weight: 600;
}

input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 12px;
  border: 1px solid #b9c7d5;
  border-radius: 10px;
  color: #172b42;
  background: white;
  font: inherit;
  font-size: 16px;
}

input[type='file'] {
  overflow: hidden;
}

button {
  width: fit-content;
  min-height: 44px;
  padding: 12px 16px;
  border: 0;
  border-radius: 10px;
  color: white;
  background: #173f65;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.secondary {
  color: #173f65;
  background: #eef3f8;
}

.danger {
  color: #942626;
  background: #fff0f0;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

input:focus-visible,
button:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 22px;
}

.photo-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #dbe5ef;
  border-radius: 12px;
}

.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  padding: 12px;
  color: #586a7d;
  background: #f5f7fa;
}

.preview img {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
}

.photo-content {
  padding: 16px;
}

.primary-badge {
  display: inline-block;
  padding: 6px 9px;
  border-radius: 7px;
  color: #18583c;
  background: #edf8f1;
  font-size: 12px;
  font-weight: 600;
}

.caption {
  color: #586a7d;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.photo-actions {
  display: grid;
  gap: 8px;
}

.photo-actions button {
  width: 100%;
}

.pagination {
  margin-top: 22px;
}

.pagination-actions {
  display: flex;
  gap: 8px;
}

.error,
.success,
.warning {
  padding: 14px;
  border-radius: 10px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.error {
  color: #942626;
  background: #fff0f0;
}

.success {
  color: #18583c;
  background: #edf8f1;
}

.warning {
  color: #755213;
  background: #fff7e5;
}

@media (max-width: 1000px) {
  .photo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .images-panel {
    padding: 20px;
  }

  .upload-form {
    padding: 16px;
  }

  .photo-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .upload-form > button,
  .pagination-actions {
    width: 100%;
  }

  .pagination-actions button {
    flex: 1;
  }
}
</style>