<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import StockInitial from './StockInitial.vue'

const props = defineProps<{
  productId: string
  productName: string
}>()

type Variant = {
  id: string
  reference: string
  label: string | null
  sales_unit: string | null
  old_price: number | null
  current_price: number | null
  low_stock_threshold: number | null
  is_active: boolean
}

const selectedStockVariant = ref<Variant | null>(null)

const columns =
  'id, reference, label, sales_unit, old_price, current_price, low_stock_threshold, is_active'

const pageSize = 10
const page = ref(1)
const total = ref(0)
const variants = ref<Variant[]>([])
const loading = ref(false)
const saving = ref(false)
const deletingId = ref<string | null>(null)

const loadError = ref('')
const formError = ref('')
const actionError = ref('')
const success = ref('')

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const reference = ref('')
const label = ref('')
const salesUnit = ref('')
const oldPrice = ref('')
const currentPrice = ref('')
const threshold = ref('')
const isActive = ref(true)

const busy = computed(
  () => loading.value || saving.value || deletingId.value !== null,
)

const stockOpen = computed(() => selectedStockVariant.value !== null)

const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize)),
)

const rangeLabel = computed(() => {
  if (total.value === 0) return '0 format'

  const start = (page.value - 1) * pageSize + 1
  const end = Math.min(page.value * pageSize, total.value)

  return `${start}–${end} sur ${total.value}`
})

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

function clearMessages() {
  formError.value = ''
  actionError.value = ''
  success.value = ''
}

function resetForm() {
  editingId.value = null
  reference.value = ''
  label.value = ''
  salesUnit.value = ''
  oldPrice.value = ''
  currentPrice.value = ''
  threshold.value = ''
  isActive.value = true
}

function openNew() {
  if (busy.value || stockOpen.value) return

  resetForm()
  clearMessages()
  formOpen.value = true
}

function closeForm() {
  if (saving.value) return

  resetForm()
  formError.value = ''
  formOpen.value = false
}

function editVariant(variant: Variant) {
  if (busy.value || stockOpen.value || formOpen.value) return

  editingId.value = variant.id
  reference.value = variant.reference
  label.value = variant.label || ''
  salesUnit.value = variant.sales_unit || ''
  oldPrice.value = variant.old_price?.toString() ?? ''
  currentPrice.value = variant.current_price?.toString() ?? ''
  threshold.value = variant.low_stock_threshold?.toString() ?? ''
  isActive.value = variant.is_active

  clearMessages()
  formOpen.value = true
}

function openStock(variant: Variant) {
  if (busy.value || formOpen.value || stockOpen.value) return

  clearMessages()
  selectedStockVariant.value = variant
}

function closeStock() {
  selectedStockVariant.value = null
}

function optionalNumber(
  input: string,
  fieldName: string,
  decimals: number,
): number | null {
  const text = input.trim()
  if (!text) return null

  const normalized = text.replace(/\s/g, '').replace(',', '.')
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`)

  if (!pattern.test(normalized)) {
    throw new Error(
      `${fieldName} : saisissez un nombre positif ou zéro, avec ${decimals} décimales maximum.`,
    )
  }

  const value = Number(normalized)
  const maximum = decimals === 2 ? 999999999999.99 : 99999999999.999

  if (!Number.isFinite(value) || value > maximum) {
    throw new Error(`${fieldName} : valeur trop élevée.`)
  }

  return value
}

function formatPrice(value: number | null) {
  if (value === null) return 'Prix sur demande'

  return `${new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 2,
  }).format(value)} FCFA`
}

async function loadPage(targetPage = page.value) {
  if (loading.value) return

  loading.value = true
  loadError.value = ''

  try {
    let requestedPage = Math.max(1, targetPage)

    while (true) {
      const offset = (requestedPage - 1) * pageSize

      const { data, error, count } = await supabase
        .from('product_variants')
        .select(columns, { count: 'exact' })
        .eq('product_id', props.productId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + pageSize - 1)

      if (error) throw error

      if (!data || count === null) {
        throw new Error('Réponse Supabase incomplète.')
      }

      const lastPage = Math.max(1, Math.ceil(count / pageSize))

      if (requestedPage > lastPage) {
        requestedPage = lastPage
        continue
      }

      variants.value = data as Variant[]
      total.value = count
      page.value = requestedPage
      break
    }
  } catch (error) {
    loadError.value = message(
      error,
      'Impossible de charger les formats de vente.',
    )
  } finally {
    loading.value = false
  }
}

async function refreshList() {
  if (busy.value || formOpen.value || stockOpen.value) return

  await loadPage()
}

async function changePage(targetPage: number) {
  if (busy.value || formOpen.value || stockOpen.value) return

  await loadPage(targetPage)
}

async function saveVariant() {
  if (busy.value || stockOpen.value) return

  clearMessages()

  if (!salesUnit.value.trim()) {
    formError.value =
      'Indiquez l’unité de vente : pièce, flacon, bidon, carton…'
    return
  }

  saving.value = true
  const variantId = editingId.value

  try {
    const newReference = reference.value.trim()

    if (variantId && !newReference) {
      throw new Error('La référence existante ne peut pas être vide.')
    }

    const payload = {
      label: label.value.trim() || null,
      sales_unit: salesUnit.value.trim(),
      old_price: optionalNumber(oldPrice.value, 'Ancien prix', 2),
      current_price: optionalNumber(currentPrice.value, 'Prix actuel', 2),
      low_stock_threshold: optionalNumber(
        threshold.value,
        'Seuil d’alerte',
        3,
      ),
      is_active: isActive.value,
    }

    const query = variantId
      ? supabase
          .from('product_variants')
          .update({ ...payload, reference: newReference })
          .eq('id', variantId)
          .eq('product_id', props.productId)
      : supabase.from('product_variants').insert({
          ...payload,
          product_id: props.productId,
          ...(newReference ? { reference: newReference } : {}),
        })

    const { data, error } = await query.select('id').single()

    if (error) {
      if (error.code === '23505') {
        throw new Error('Cette référence est déjà utilisée.')
      }

      throw error
    }

    if (!data) {
      throw new Error('L’enregistrement n’a pas été confirmé.')
    }

    resetForm()
    formOpen.value = false
    success.value = variantId
      ? 'Le format de vente a été mis à jour.'
      : 'Le format de vente a été ajouté.'

    await loadPage(variantId ? page.value : 1)
  } catch (error) {
    formError.value = message(
      error,
      'Impossible d’enregistrer le format de vente.',
    )
  } finally {
    saving.value = false
  }
}

async function deleteVariant(variant: Variant) {
  if (busy.value || formOpen.value || stockOpen.value) return

  const title = variant.label || variant.sales_unit || variant.reference

  const confirmed = window.confirm(
    `Supprimer définitivement « ${title} » ?\n\n` +
      'Cette action est irréversible. Un format possédant un historique de stock ne peut pas être supprimé.',
  )

  if (!confirmed) return

  deletingId.value = variant.id
  actionError.value = ''
  success.value = ''

  try {
    const { data, error } = await supabase
      .from('product_variants')
      .delete()
      .eq('id', variant.id)
      .eq('product_id', props.productId)
      .select('id')
      .single()

    if (error) {
      if (error.code === '23503') {
        throw new Error(
          'Ce format est lié à un historique. Cliquez sur Modifier, puis choisissez Inactif.',
        )
      }

      throw error
    }

    if (!data) {
      throw new Error('La suppression n’a pas été confirmée.')
    }

    variants.value = variants.value.filter(
      (item) => item.id !== variant.id,
    )
    total.value = Math.max(0, total.value - 1)

    success.value = 'Le format de vente a été supprimé.'

    await loadPage(page.value)
  } catch (error) {
    actionError.value = message(
      error,
      'Impossible de supprimer ce format de vente.',
    )
  } finally {
    deletingId.value = null
  }
}

onMounted(() => loadPage(1))
</script>

<template>
  <section class="variants-panel" aria-labelledby="variants-title">
    <header class="heading">
      <div>
        <p class="eyebrow">FORMATS DE VENTE ET PRIX</p>
        <h2 id="variants-title">{{ productName }}</h2>
        <p class="help">
          Ajoutez les différentes présentations vendues :
          flacon 1 L, bidon 10 L, carton de 12 ou machine seule.
        </p>
      </div>

      <button
        v-if="!formOpen"
        type="button"
        :disabled="busy || stockOpen"
        @click="openNew"
      >
        Ajouter un format de vente
      </button>
    </header>

    <StockInitial
      v-if="selectedStockVariant"
      :key="selectedStockVariant.id"
      :variant-id="selectedStockVariant.id"
      :variant-name="
        selectedStockVariant.label ||
        selectedStockVariant.sales_unit ||
        selectedStockVariant.reference
      "
      @close="closeStock"
    />

    <form
      v-if="formOpen"
      class="variant-form"
      :aria-busy="saving"
      @submit.prevent="saveVariant"
    >
      <h3 class="full-width">
        {{
          editingId
            ? 'Modifier le format de vente'
            : 'Nouveau format de vente'
        }}
      </h3>

      <div class="full-width">
        <label for="variant-label">
          Format ou présentation du produit
        </label>
        <input
          id="variant-label"
          v-model="label"
          :disabled="saving"
          placeholder="Ex. Flacon 1 L, bidon 10 L, carton de 12, machine seule"
        />
      </div>

      <div>
        <label for="variant-unit">Vendu à l’unité, au carton… *</label>
        <input
          id="variant-unit"
          v-model="salesUnit"
          :disabled="saving"
          required
          placeholder="Ex. pièce, flacon, bidon, carton"
        />
      </div>

      <div>
        <label for="variant-reference">
          Référence du format de vente
        </label>
        <input
          id="variant-reference"
          v-model="reference"
          :disabled="saving"
          :required="!!editingId"
          placeholder="Automatique si vide lors de l’ajout"
        />
      </div>

      <div>
        <label for="variant-old-price">Ancien prix — FCFA</label>
        <input
          id="variant-old-price"
          v-model="oldPrice"
          inputmode="decimal"
          :disabled="saving"
          placeholder="Ex. 35 000 — facultatif"
        />
      </div>

      <div>
        <label for="variant-current-price">Prix actuel — FCFA</label>
        <input
          id="variant-current-price"
          v-model="currentPrice"
          inputmode="decimal"
          :disabled="saving"
          placeholder="Ex. 31 200 — facultatif"
        />
      </div>

      <div>
        <label for="variant-threshold">
          Alerter quand le stock atteint
        </label>
        <input
          id="variant-threshold"
          v-model="threshold"
          inputmode="decimal"
          :disabled="saving"
          placeholder="Ex. 5 unités restantes — facultatif"
        />
      </div>

      <div>
        <label for="variant-active">État du format de vente</label>
        <select
          id="variant-active"
          v-model="isActive"
          :disabled="saving"
        >
          <option :value="true">Actif</option>
          <option :value="false">Inactif</option>
        </select>
      </div>

      <p class="help full-width">
        * Champ obligatoire. Les deux prix sont indépendants.
      </p>

      <p v-if="formError" class="error full-width" role="alert">
        {{ formError }}
      </p>

      <div class="actions full-width">
        <button type="submit" :disabled="busy">
          {{
            saving
              ? 'Enregistrement…'
              : 'Enregistrer le format de vente'
          }}
        </button>

        <button
          type="button"
          class="secondary"
          :disabled="saving"
          @click="closeForm"
        >
          Annuler
        </button>
      </div>
    </form>

    <p v-if="success" class="success" role="status">{{ success }}</p>

    <p v-if="actionError" class="error" role="alert">
      {{ actionError }}
    </p>

    <div class="list-heading">
      <h3>Formats enregistrés</h3>
      <button
        type="button"
        class="secondary"
        :disabled="busy || formOpen || stockOpen"
        @click="refreshList"
      >
        Actualiser
      </button>
    </div>

    <p v-if="stockOpen" class="help">
      Fermez le panneau Stock pour modifier un format ou changer de page.
    </p>

    <p v-if="loading" role="status">Chargement des formats…</p>

    <p v-else-if="loadError" class="error" role="alert">
      {{ loadError }}
    </p>

    <template v-else>
      <p v-if="total === 0" class="help">
        Aucun format de vente enregistré pour ce produit.
      </p>

      <ul v-else class="format-list" aria-label="Formats de vente">
        <li v-for="variant in variants" :key="variant.id">
          <div class="format-info">
            <strong>
              {{
                variant.label ||
                variant.sales_unit ||
                'Unité de vente à compléter'
              }}
            </strong>

            <span class="reference">{{ variant.reference }}</span>

            <span v-if="!variant.is_active" class="inactive">
              Inactif
            </span>

            <details>
              <summary>Voir les détails</summary>
              <dl>
                <dt>Unité de vente</dt>
                <dd>{{ variant.sales_unit || 'À compléter' }}</dd>

                <dt>Ancien prix</dt>
                <dd>
                  {{
                    variant.old_price === null
                      ? 'Non renseigné'
                      : formatPrice(variant.old_price)
                  }}
                </dd>

                <dt>Seuil d’alerte</dt>
                <dd>
                  {{ variant.low_stock_threshold ?? 'Non renseigné' }}
                </dd>
              </dl>
            </details>
          </div>

          <strong class="price">
            {{ formatPrice(variant.current_price) }}
          </strong>

          <div class="actions row-actions">
            <button
              type="button"
              class="secondary"
              :disabled="busy || formOpen || stockOpen"
              :aria-label="`Consulter le stock de ${variant.label || variant.reference}`"
              @click="openStock(variant)"
            >
              Stock
            </button>

            <button
              type="button"
              class="secondary"
              :disabled="busy || formOpen || stockOpen"
              :aria-label="`Modifier ${variant.label || variant.reference}`"
              @click="editVariant(variant)"
            >
              Modifier
            </button>

            <button
              type="button"
              class="delete-button"
              :disabled="busy || formOpen || stockOpen"
              :aria-label="`Supprimer ${variant.label || variant.reference}`"
              @click="deleteVariant(variant)"
            >
              {{
                deletingId === variant.id
                  ? 'Suppression…'
                  : 'Supprimer'
              }}
            </button>
          </div>
        </li>
      </ul>

      <nav
        v-if="total > 0"
        class="pagination"
        aria-label="Pages des formats de vente"
      >
        <p aria-live="polite">{{ rangeLabel }}</p>

        <div class="actions">
          <button
            type="button"
            class="secondary"
            :disabled="busy || formOpen || stockOpen || page <= 1"
            @click="changePage(page - 1)"
          >
            Précédent
          </button>

          <span>Page {{ page }} / {{ pageCount }}</span>

          <button
            type="button"
            class="secondary"
            :disabled="busy || formOpen || stockOpen || page >= pageCount"
            @click="changePage(page + 1)"
          >
            Suivant
          </button>
        </div>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.variants-panel {
  min-width: 0;
  padding: 26px;
  border: 1px solid #d5e0eb;
  border-radius: 16px;
  background: white;
}

.heading,
.list-heading,
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.heading > div {
  flex: 1 1 280px;
  min-width: 0;
}

.eyebrow {
  color: #526b82;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
}

h2 {
  margin: 0;
  font-size: 22px;
  overflow-wrap: anywhere;
}

h3 {
  font-size: 17px;
}

.help {
  color: #586a7d;
  line-height: 1.6;
}

.variant-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 24px;
  padding: 22px;
  border: 1px solid #dce5ee;
  border-radius: 12px;
  background: #f7f9fc;
}

.variant-form > div {
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
select {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 12px;
  border: 1px solid #b9c7d5;
  border-radius: 10px;
  background: white;
  color: #172b42;
  font: inherit;
  font-size: 16px;
}

button {
  width: auto;
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

button:hover:not(:disabled) {
  background: #102f4d;
}

.secondary {
  color: #173f65;
  background: #eef3f8;
}

.secondary:hover:not(:disabled) {
  background: #dde8f2;
}

.delete-button {
  color: #942626;
  background: #fff0f0;
}

.delete-button:hover:not(:disabled) {
  color: #7a1d1d;
  background: #ffe0e0;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input:focus-visible,
select:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.row-actions {
  justify-content: flex-end;
}

.list-heading {
  margin-top: 24px;
}

.format-list {
  margin: 12px 0;
  padding: 0;
  list-style: none;
}

.format-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 260px);
  align-items: start;
  gap: 20px;
  padding: 20px 0;
  border-bottom: 1px solid #e0e7ef;
}

.format-info {
  display: grid;
  gap: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.reference {
  color: #586a7d;
  font-size: 12px;
}

.price {
  color: #173f65;
  font-size: 15px;
  overflow-wrap: anywhere;
}

.inactive {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 6px;
  background: #f1f3f5;
  color: #586a7d;
  font-size: 12px;
}

summary {
  width: fit-content;
  padding: 8px 0;
  color: #173f65;
  font-size: 13px;
  cursor: pointer;
}

dl {
  margin: 8px 0;
  font-size: 13px;
}

dt {
  margin-top: 10px;
  color: #586a7d;
}

dd {
  margin: 4px 0 0;
}

.pagination {
  margin-top: 20px;
  color: #526579;
  font-size: 13px;
}

.success,
.error {
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

@media (max-width: 900px) {
  .format-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .row-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .variants-panel,
  .variant-form {
    padding: 18px;
  }

  .variant-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .format-list li {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .heading > button,
  .variant-form .actions button {
    width: 100%;
  }

  .pagination .actions {
    width: 100%;
    justify-content: space-between;
  }

  .row-actions button {
    flex: 1 1 100px;
  }
}
</style>