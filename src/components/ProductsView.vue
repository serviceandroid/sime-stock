<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { supabase } from '../lib/supabase'
import ProductVariants from './ProductVariants.vue'
import ProductImages from './ProductImages.vue'
import CatalogueExport from './CatalogueExport.vue'

type Product = {
  id: string
  name: string
  item_type: 'product' | 'equipment'
  category_id: string | null
  brand_id: string | null
  short_description: string | null
  description: string | null
  technical_details: string | null
  usage_instructions: string | null
  safety_notes: string | null
  internal_notes: string | null
  status: 'draft' | 'active' | 'archived'
}

type Lookup = {
  id: string
  name: string
}

type LookupTable = 'categories' | 'brands'

type TextField =
  | 'description'
  | 'technical_details'
  | 'usage_instructions'
  | 'safety_notes'
  | 'internal_notes'

const productColumns = `
  id, name, item_type, category_id, brand_id,
  short_description, description, technical_details,
  usage_instructions, safety_notes, internal_notes, status
`

function emptyForm() {
  return {
    name: '',
    item_type: 'product' as Product['item_type'],
    category_id: '',
    brand_id: '',
    short_description: '',
    description: '',
    technical_details: '',
    usage_instructions: '',
    safety_notes: '',
    internal_notes: '',
    status: 'draft' as Product['status'],
  }
}

const form = reactive(emptyForm())
const products = ref<Product[]>([])
const categories = ref<Lookup[]>([])
const brands = ref<Lookup[]>([])
const editingId = ref<string | null>(null)
const search = ref('')

const loading = ref(false)
const saving = ref(false)
const imagesBusy = ref(false)
const exportBusy = ref(false)
const lookupLoading = ref(false)
const lookupSaving = ref<LookupTable | null>(null)

const newCategory = ref('')
const newBrand = ref('')

const loadError = ref('')
const lookupError = ref('')
const errorMessage = ref('')
const successMessage = ref('')

const detailFields: {
  key: TextField
  label: string
  placeholder: string
}[] = [
  {
    key: 'description',
    label: 'Description détaillée — facultative',
    placeholder:
      'Présentez le produit, ses avantages et les besoins auxquels il répond.',
  },
  {
    key: 'technical_details',
    label: 'Caractéristiques techniques — facultatives',
    placeholder:
      'Ex. Composition, dimensions, puissance, matériaux… Une information par ligne.',
  },
  {
    key: 'usage_instructions',
    label: 'Conseils d’utilisation — facultatifs',
    placeholder:
      'Ex. Dilution recommandée, surfaces adaptées, méthode d’application…',
  },
  {
    key: 'safety_notes',
    label: 'Précautions d’emploi — facultatives',
    placeholder:
      'Ex. Porter des gants. Conserver hors de portée des enfants.',
  },
  {
    key: 'internal_notes',
    label: 'Notes internes — facultatives',
    placeholder:
      'Informations réservées à votre équipe, exclues du catalogue commercial.',
  },
]

const editorBusy = computed(
  () =>
    loading.value ||
    saving.value ||
    imagesBusy.value ||
    lookupLoading.value ||
    lookupSaving.value !== null,
)

const pageLocked = computed(
  () => editorBusy.value || exportBusy.value,
)

const editingProductName = computed(
  () =>
    products.value.find((product) => product.id === editingId.value)
      ?.name || 'Produit',
)

const filteredProducts = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('fr')

  return products.value.filter((product) =>
    product.name.toLocaleLowerCase('fr').includes(term),
  )
})

function getErrorMessage(error: unknown, fallback: string): string {
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

function getErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }

  return null
}

function fillForm(product: Product) {
  Object.assign(form, {
    name: product.name,
    item_type: product.item_type,
    category_id: product.category_id || '',
    brand_id: product.brand_id || '',
    short_description: product.short_description || '',
    description: product.description || '',
    technical_details: product.technical_details || '',
    usage_instructions: product.usage_instructions || '',
    safety_notes: product.safety_notes || '',
    internal_notes: product.internal_notes || '',
    status: product.status,
  })
}

function resetForm() {
  editingId.value = null
  Object.assign(form, emptyForm())
  newCategory.value = ''
  newBrand.value = ''
  imagesBusy.value = false
}

function editProduct(product: Product) {
  if (pageLocked.value) return

  editingId.value = product.id
  fillForm(product)
  newCategory.value = ''
  newBrand.value = ''
  errorMessage.value = ''
  successMessage.value = ''

  document.getElementById('product-name')?.focus()
}

function cancelEdit() {
  if (pageLocked.value) return

  resetForm()
  errorMessage.value = ''
  successMessage.value = ''
}

function lookupName(items: Lookup[], id: string | null): string {
  if (!id) return ''
  return items.find((item) => item.id === id)?.name || ''
}

async function fetchLookup(table: LookupTable): Promise<Lookup[]> {
  const items: Lookup[] = []
  const batchSize = 500
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('id, name')
      .order('name')
      .order('id')
      .range(offset, offset + batchSize - 1)

    if (error) throw error
    if (!data) throw new Error('Réponse incomplète pour les listes.')

    items.push(...(data as Lookup[]))

    if (data.length < batchSize) break
    offset += batchSize
  }

  return items
}

async function loadLookups() {
  if (pageLocked.value) return

  lookupLoading.value = true
  lookupError.value = ''

  try {
    const [loadedCategories, loadedBrands] = await Promise.all([
      fetchLookup('categories'),
      fetchLookup('brands'),
    ])

    categories.value = loadedCategories
    brands.value = loadedBrands
  } catch (error) {
    lookupError.value = getErrorMessage(
      error,
      'Impossible de charger les catégories et les marques.',
    )
  } finally {
    lookupLoading.value = false
  }
}

async function createLookup(table: LookupTable) {
  if (pageLocked.value || lookupError.value) return

  errorMessage.value = ''
  successMessage.value = ''

  const name = (
    table === 'categories' ? newCategory.value : newBrand.value
  ).trim()

  if (!name) {
    errorMessage.value =
      table === 'categories'
        ? 'Saisissez le nom de la nouvelle catégorie.'
        : 'Saisissez le nom de la nouvelle marque.'
    return
  }

  lookupSaving.value = table

  try {
    const currentItems =
      table === 'categories' ? categories.value : brands.value

    let selected = currentItems.find(
      (item) =>
        item.name.trim().toLocaleLowerCase('fr') ===
        name.toLocaleLowerCase('fr'),
    )

    if (!selected) {
      const { data, error } = await supabase
        .from(table)
        .insert({ name })
        .select('id, name')
        .single()

      if (error) {
        if (getErrorCode(error) !== '23505') throw error

        const refreshed = await fetchLookup(table)

        if (table === 'categories') categories.value = refreshed
        else brands.value = refreshed

        selected = refreshed.find(
          (item) =>
            item.name.trim().toLocaleLowerCase('fr') ===
            name.toLocaleLowerCase('fr'),
        )

        if (!selected) {
          throw new Error(
            'Ce nom existe déjà. Rechargez les listes et sélectionnez-le.',
          )
        }
      } else {
        if (!data) throw new Error('Élément enregistré introuvable.')

        selected = data as Lookup

        const updated = [...currentItems, selected].sort((a, b) =>
          a.name.localeCompare(b.name, 'fr'),
        )

        if (table === 'categories') categories.value = updated
        else brands.value = updated
      }
    }

    if (!selected) throw new Error('Élément introuvable.')

    if (table === 'categories') {
      form.category_id = selected.id
      newCategory.value = ''
    } else {
      form.brand_id = selected.id
      newBrand.value = ''
    }

    successMessage.value =
      'Élément sélectionné. Enregistrez la fiche pour conserver cette association.'
  } catch (error) {
    errorMessage.value = getErrorMessage(
      error,
      'Impossible de créer cet élément.',
    )
  } finally {
    lookupSaving.value = null
  }
}

async function loadProducts() {
  if (pageLocked.value) return

  loading.value = true
  loadError.value = ''

  try {
    const allProducts: Product[] = []
    const batchSize = 500
    let offset = 0

    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(productColumns)
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + batchSize - 1)

      if (error) throw error
      if (!data) throw new Error('Aucune réponse reçue de Supabase.')

      allProducts.push(...(data as Product[]))

      if (data.length < batchSize) break
      offset += batchSize
    }

    products.value = allProducts

    if (
      editingId.value &&
      !allProducts.some((product) => product.id === editingId.value)
    ) {
      resetForm()
      errorMessage.value =
        'La fiche ouverte n’est plus disponible dans la liste courante.'
    }
  } catch (error) {
    loadError.value = getErrorMessage(
      error,
      'Impossible de charger les produits.',
    )
  } finally {
    loading.value = false
  }
}

async function saveProduct() {
  if (pageLocked.value) return

  errorMessage.value = ''
  successMessage.value = ''

  if (!form.name.trim()) {
    errorMessage.value = 'Veuillez renseigner le nom.'
    return
  }

  if (
    form.status === 'archived' &&
    !window.confirm(
      'Archiver cette fiche ? Elle sera retirée de la liste courante.',
    )
  ) {
    return
  }

  saving.value = true
  const productId = editingId.value

  const payload = {
    name: form.name.trim(),
    item_type: form.item_type,
    category_id: form.category_id || null,
    brand_id: form.brand_id || null,
    short_description: form.short_description.trim() || null,
    description: form.description.trim() || null,
    technical_details: form.technical_details.trim() || null,
    usage_instructions: form.usage_instructions.trim() || null,
    safety_notes: form.safety_notes.trim() || null,
    internal_notes: form.internal_notes.trim() || null,
    status: form.status,
  }

  try {
    const query = productId
      ? supabase.from('products').update(payload).eq('id', productId)
      : supabase.from('products').insert(payload)

    const { data, error } = await query
      .select(productColumns)
      .single()

    if (error) throw error
    if (!data) throw new Error('La fiche enregistrée est introuvable.')

    const savedProduct = data as Product

    if (savedProduct.status === 'archived') {
      products.value = products.value.filter(
        (product) => product.id !== savedProduct.id,
      )

      resetForm()
      successMessage.value = 'La fiche a été archivée.'
    } else {
      if (productId) {
        products.value = products.value.map((product) =>
          product.id === savedProduct.id ? savedProduct : product,
        )
      } else {
        products.value = [savedProduct, ...products.value]
      }

      editingId.value = savedProduct.id
      fillForm(savedProduct)

      successMessage.value = productId
        ? 'Les modifications ont été enregistrées.'
        : 'La fiche a été créée. Vous pouvez ajouter ses photos et ses formats de vente.'
    }

    search.value = ''
  } catch (error) {
    errorMessage.value = getErrorMessage(
      error,
      'Impossible d’enregistrer la fiche.',
    )
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadProducts()
  await loadLookups()
})
</script>

<template>
  <section class="products-page" aria-labelledby="products-title">
    <header>
      <p class="section-label">CATALOGUE SIME</p>
      <h1 id="products-title">Produits et matériels</h1>
      <p class="intro-text">
        Gérez les fiches, les photos et les formats de vente.
      </p>
    </header>

    <div class="export-section">
      <p v-if="editingId" class="notice">
        Pour exporter le catalogue, enregistrez vos modifications puis
        cliquez sur « Fermer la fiche ».
      </p>

      <fieldset
        class="component-group"
        :disabled="editorBusy || editingId !== null"
        aria-label="Export du catalogue commercial"
      >
        <CatalogueExport @busy-change="exportBusy = $event" />
      </fieldset>
    </div>

    <p v-if="exportBusy" class="notice" role="status">
      Le catalogue est en cours de génération. Gardez cette page
      ouverte jusqu’au lancement du téléchargement.
    </p>

    <section class="panel" aria-labelledby="form-title">
      <h2 id="form-title">
        {{ editingId ? 'Modifier la fiche' : 'Ajouter une fiche' }}
      </h2>

      <p class="help-text">
        Seul le nom est obligatoire. Les autres informations peuvent
        être complétées plus tard.
      </p>

      <p v-if="imagesBusy" class="notice" role="status">
        Une opération sur les photos est en cours. Patientez avant
        de modifier ou de fermer cette fiche.
      </p>

      <div v-if="lookupError" class="error" role="alert">
        <p>{{ lookupError }}</p>
        <button
          type="button"
          class="secondary-button"
          :disabled="pageLocked"
          @click="loadLookups"
        >
          Recharger les catégories et marques
        </button>
      </div>

      <form
        class="product-form"
        :aria-busy="saving"
        @submit.prevent="saveProduct"
      >
        <div>
          <label for="product-name">Nom *</label>
          <input
            id="product-name"
            v-model="form.name"
            :disabled="pageLocked"
            required
            placeholder="Ex. Nettoyant Mistral"
          />
        </div>

        <div>
          <label for="product-type">Type</label>
          <select
            id="product-type"
            v-model="form.item_type"
            :disabled="pageLocked"
          >
            <option value="product">Produit</option>
            <option value="equipment">Matériel</option>
          </select>
        </div>

        <div class="lookup-field">
          <label for="product-category">Catégorie — facultative</label>
          <select
            id="product-category"
            v-model="form.category_id"
            :disabled="pageLocked || !!lookupError"
          >
            <option value="">Sans catégorie</option>
            <option
              v-if="
                form.category_id &&
                !categories.some((item) => item.id === form.category_id)
              "
              :value="form.category_id"
            >
              Catégorie actuelle — nom indisponible
            </option>
            <option
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>

          <details class="lookup-create">
            <summary>Créer une catégorie</summary>
            <label for="new-category">Nom de la catégorie</label>
            <input
              id="new-category"
              v-model="newCategory"
              placeholder="Ex. Nettoyage des sols"
              :disabled="pageLocked || !!lookupError"
              @keydown.enter.prevent="createLookup('categories')"
            />
            <button
              type="button"
              class="secondary-button"
              :disabled="
                pageLocked || !!lookupError || !newCategory.trim()
              "
              @click="createLookup('categories')"
            >
              {{
                lookupSaving === 'categories'
                  ? 'Création…'
                  : 'Créer et sélectionner'
              }}
            </button>
          </details>
        </div>

        <div class="lookup-field">
          <label for="product-brand">Marque — facultative</label>
          <select
            id="product-brand"
            v-model="form.brand_id"
            :disabled="pageLocked || !!lookupError"
          >
            <option value="">Sans marque</option>
            <option
              v-if="
                form.brand_id &&
                !brands.some((item) => item.id === form.brand_id)
              "
              :value="form.brand_id"
            >
              Marque actuelle — nom indisponible
            </option>
            <option
              v-for="brand in brands"
              :key="brand.id"
              :value="brand.id"
            >
              {{ brand.name }}
            </option>
          </select>

          <details class="lookup-create">
            <summary>Créer une marque</summary>
            <label for="new-brand">Nom de la marque</label>
            <input
              id="new-brand"
              v-model="newBrand"
              placeholder="Ex. Nom du fabricant"
              :disabled="pageLocked || !!lookupError"
              @keydown.enter.prevent="createLookup('brands')"
            />
            <button
              type="button"
              class="secondary-button"
              :disabled="
                pageLocked || !!lookupError || !newBrand.trim()
              "
              @click="createLookup('brands')"
            >
              {{
                lookupSaving === 'brands'
                  ? 'Création…'
                  : 'Créer et sélectionner'
              }}
            </button>
          </details>
        </div>

        <div class="full-width">
          <label for="product-short-description">
            Description courte — facultative
          </label>
          <textarea
            id="product-short-description"
            v-model="form.short_description"
            :disabled="pageLocked"
            rows="3"
            placeholder="Résumez l’utilité du produit en quelques mots."
          ></textarea>
        </div>

        <details class="details-section full-width">
          <summary>Description et informations complémentaires</summary>

          <div class="details-fields">
            <div
              v-for="field in detailFields"
              :key="field.key"
              class="detail-field"
            >
              <label :for="`product-${field.key}`">
                {{ field.label }}
              </label>

              <p
                v-if="field.key === 'internal_notes'"
                class="internal-help"
              >
                Réservées à votre équipe. Ces notes sont exclues
                du catalogue destiné aux commerciaux.
              </p>

              <textarea
                :id="`product-${field.key}`"
                v-model="form[field.key]"
                :disabled="pageLocked"
                :placeholder="field.placeholder"
                rows="4"
              ></textarea>
            </div>
          </div>
        </details>

        <div class="full-width">
          <label for="product-status">Statut</label>
          <select
            id="product-status"
            v-model="form.status"
            :disabled="pageLocked"
          >
            <option value="draft">Brouillon</option>
            <option value="active">Actif</option>
            <option v-if="editingId" value="archived">Archivé</option>
          </select>
        </div>

        <div class="form-actions full-width">
          <button :disabled="pageLocked" type="submit">
            {{
              saving
                ? 'Enregistrement…'
                : editingId
                  ? 'Enregistrer les modifications'
                  : 'Créer la fiche'
            }}
          </button>

          <button
            v-if="editingId"
            class="secondary-button"
            type="button"
            :disabled="pageLocked"
            @click="cancelEdit"
          >
            Fermer la fiche
          </button>
        </div>
      </form>

      <p v-if="successMessage" class="success" role="status">
        {{ successMessage }}
      </p>

      <p v-if="errorMessage" class="error" role="alert">
        {{ errorMessage }}
      </p>
    </section>

    <template v-if="editingId">
      <p class="editing-notice">
        Photos et formats de vente de :
        <strong>{{ editingProductName }}</strong>
      </p>

      <fieldset
        class="component-group"
        :disabled="
          saving ||
          loading ||
          exportBusy ||
          lookupLoading ||
          lookupSaving !== null
        "
        aria-label="Photos du produit"
      >
        <ProductImages
          :key="`images-${editingId}`"
          :product-id="editingId"
          :product-name="editingProductName"
          @busy-change="imagesBusy = $event"
        />
      </fieldset>

      <fieldset
        class="component-group"
        :disabled="
          saving ||
          loading ||
          imagesBusy ||
          exportBusy ||
          lookupLoading ||
          lookupSaving !== null
        "
        aria-label="Formats de vente du produit"
      >
        <ProductVariants
          :key="`variants-${editingId}`"
          :product-id="editingId"
          :product-name="editingProductName"
        />
      </fieldset>
    </template>

    <section
      class="panel"
      aria-labelledby="list-title"
      :aria-busy="loading"
    >
      <div class="list-header">
        <h2 id="list-title">Vos fiches</h2>
        <button
          class="secondary-button"
          type="button"
          :disabled="pageLocked"
          @click="loadProducts"
        >
          {{ loading ? 'Chargement…' : 'Actualiser' }}
        </button>
      </div>

      <label for="product-search">Rechercher par nom</label>
      <input
        id="product-search"
        v-model="search"
        type="search"
        :disabled="exportBusy"
        placeholder="Nom du produit ou du matériel"
      />

      <p v-if="loading" role="status">Chargement des fiches…</p>

      <p v-else-if="loadError" class="error" role="alert">
        {{ loadError }}
      </p>

      <template v-else>
        <p class="help-text">
          {{ filteredProducts.length }} fiche(s) affichée(s)
        </p>

        <p
          v-if="filteredProducts.length === 0"
          class="empty-state"
        >
          {{
            search.trim()
              ? 'Aucune fiche ne correspond à votre recherche.'
              : 'Aucune fiche enregistrée pour le moment.'
          }}
        </p>

        <div v-else class="product-grid">
          <article
            v-for="product in filteredProducts"
            :key="product.id"
            class="product-card"
            :class="{ 'card-selected': editingId === product.id }"
          >
            <span class="product-type">
              {{
                product.item_type === 'equipment'
                  ? 'Matériel'
                  : 'Produit'
              }}
            </span>

            <h3>{{ product.name }}</h3>

            <p
              v-if="lookupName(categories, product.category_id)"
              class="classification"
            >
              Catégorie :
              {{ lookupName(categories, product.category_id) }}
            </p>

            <p
              v-if="lookupName(brands, product.brand_id)"
              class="classification"
            >
              Marque : {{ lookupName(brands, product.brand_id) }}
            </p>

            <p v-if="product.short_description">
              {{ product.short_description }}
            </p>

            <span
              class="status"
              :class="{ 'status-active': product.status === 'active' }"
            >
              {{ product.status === 'draft' ? 'Brouillon' : 'Actif' }}
            </span>

            <button
              class="edit-button secondary-button"
              type="button"
              :disabled="pageLocked"
              :aria-label="`Modifier ${product.name}`"
              @click="editProduct(product)"
            >
              {{
                editingId === product.id ? 'Fiche ouverte' : 'Modifier'
              }}
            </button>
          </article>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.products-page {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.section-label {
  color: #526b82;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
}

h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 36px);
}

.intro-text,
.help-text {
  color: #586a7d;
  line-height: 1.6;
}

.panel {
  min-width: 0;
  padding: 26px;
  border: 1px solid #e0e7ef;
  border-radius: 16px;
  background: #fff;
}

h2 {
  margin: 0;
  font-size: 21px;
}

.product-form {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 18px;
  margin-top: 20px;
}

.product-form > div {
  min-width: 0;
}

.full-width {
  grid-column: 1 / -1;
}

label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

input,
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  margin-bottom: 0;
  padding: 12px;
  border: 1px solid #b9c7d5;
  border-radius: 10px;
  color: #172b42;
  background: #fff;
  font: inherit;
  font-size: 16px;
}

textarea {
  resize: vertical;
}

input:focus-visible,
select:focus-visible,
textarea:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

button {
  min-height: 48px;
  padding: 12px 16px;
  border: 0;
  border-radius: 10px;
  color: #fff;
  background: #173f65;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #102f4d;
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.form-actions button {
  width: auto;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.secondary-button {
  width: auto;
  background: #eef3f8;
  color: #173f65;
}

.secondary-button:hover:not(:disabled) {
  background: #dde8f2;
}

.lookup-create {
  margin-top: 12px;
}

summary {
  color: #173f65;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.6;
}

.lookup-create[open] summary {
  margin-bottom: 14px;
}

.lookup-create button {
  margin-top: 10px;
}

.details-section {
  min-width: 0;
  padding: 18px;
  border: 1px solid #dbe5ef;
  border-radius: 12px;
  background: #f7fafd;
}

.details-fields {
  display: grid;
  gap: 20px;
  margin-top: 20px;
}

.detail-field {
  min-width: 0;
}

.internal-help {
  margin: 0 0 10px;
  color: #755213;
  font-size: 14px;
  line-height: 1.6;
}

.component-group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.export-section {
  min-width: 0;
}

.export-section > .notice {
  margin: 0 0 12px;
}

.editing-notice {
  margin: 0;
  color: #526b82;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 20px;
}

.product-card {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e0e7ef;
  border-radius: 12px;
  overflow-wrap: anywhere;
}

.card-selected {
  border-color: #89b9df;
  background: #f5f9fd;
}

.product-type {
  color: #526b82;
  font-size: 12px;
}

h3 {
  margin: 12px 0;
  font-size: 18px;
}

.product-card p {
  color: #586a7d;
  line-height: 1.6;
  white-space: pre-line;
}

.product-card .classification {
  margin: 6px 0;
  font-size: 13px;
}

.status {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 8px;
  color: #173f65;
  background: #eef3f8;
  font-size: 12px;
}

.status-active {
  color: #18583c;
  background: #edf8f1;
}

.edit-button {
  display: block;
  width: 100%;
  margin-top: 18px;
}

.empty-state {
  padding: 24px 0;
  color: #586a7d;
}

.success,
.error,
.notice {
  padding: 14px;
  border-radius: 10px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.success {
  color: #18583c;
  background: #edf8f1;
}

.error {
  color: #942626;
  background: #fff0f0;
}

.notice {
  color: #173f65;
  background: #eef3f8;
}

@media (max-width: 640px) {
  .panel {
    padding: 20px;
  }

  .product-form,
  .product-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .list-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-actions button,
  .lookup-create button {
    width: 100%;
  }

  .details-section {
    padding: 16px;
  }
}
</style>