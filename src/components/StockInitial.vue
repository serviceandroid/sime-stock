<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'

const props = defineProps<{
  variantId: string
  variantName: string
}>()

defineEmits<{
  close: []
}>()

type MovementType = 'initial' | 'entry' | 'exit' | 'return' | 'adjustment'
type EditableType = 'entry' | 'exit' | 'return'

type StockSummary = {
  stock_initialized_at: string | null
  stock_quantity: number | null
  sales_unit: string | null
  is_active: boolean
  product_status: string
}

type Movement = {
  id: string
  movement_type: MovementType
  quantity_change: number
  reason: string
  document_reference: string | null
  created_at: string
}

type MovementPayload = {
  request_id: string
  variant_id: string
  movement_type: MovementType
  quantity_change: number
  reason: string
  document_reference: string | null
}

const stock = ref<StockSummary | null>(null)
const quantity = ref('')
const reason = ref('Inventaire initial')
const documentReference = ref('')
const movementType = ref<EditableType>('entry')

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const formError = ref('')
const success = ref('')

// Si la réponse réseau est incertaine, on conserve exactement
// le même mouvement et le même identifiant pour la nouvelle tentative.
const pendingMovement = ref<MovementPayload | null>(null)

const movements = ref<Movement[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const historyPage = ref(1)
const historyTotal = ref(0)
const pageSize = 10

const initialized = computed(
  () => stock.value?.stock_initialized_at != null,
)

const canMove = computed(
  () =>
    stock.value !== null &&
    stock.value.is_active &&
    stock.value.product_status !== 'archived',
)

const fieldsLocked = computed(
  () => saving.value || pendingMovement.value !== null,
)

const historyPageCount = computed(() =>
  Math.max(1, Math.ceil(historyTotal.value / pageSize)),
)

const historyStart = computed(() =>
  historyTotal.value === 0
    ? 0
    : (historyPage.value - 1) * pageSize + 1,
)

const historyEnd = computed(() =>
  Math.min(historyPage.value * pageSize, historyTotal.value),
)

const movementLabels: Record<MovementType, string> = {
  initial: 'Stock initial',
  entry: 'Entrée',
  exit: 'Sortie',
  return: 'Retour',
  adjustment: 'Ajustement',
}

const submitLabel = computed(() => {
  if (saving.value) return 'Enregistrement…'
  if (pendingMovement.value) return 'Vérifier et réessayer'
  if (!initialized.value) return 'Enregistrer le stock initial'

  return `Enregistrer ${
    movementType.value === 'entry'
      ? 'l’entrée'
      : movementType.value === 'exit'
        ? 'la sortie'
        : 'le retour'
  }`
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

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 3,
  }).format(value)
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date indisponible'

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

async function loadStock() {
  loading.value = true
  loadError.value = ''

  try {
    const { data, error } = await supabase
      .from('stock_summary')
      .select(
        'stock_initialized_at, stock_quantity, sales_unit, is_active, product_status',
      )
      .eq('variant_id', props.variantId)
      .single()

    if (error) throw error
    if (!data) throw new Error('Référence introuvable.')

    stock.value = data as StockSummary

    if (initialized.value && reason.value === 'Inventaire initial') {
      reason.value = ''
    }
  } catch (error) {
    stock.value = null
    loadError.value = message(error, 'Impossible de charger le stock.')
  } finally {
    loading.value = false
  }
}

async function loadHistory(targetPage = historyPage.value) {
  if (historyLoading.value) return

  historyLoading.value = true
  historyError.value = ''

  try {
    let requestedPage = Math.max(1, targetPage)

    // Recalcule la dernière page si le nombre de lignes a changé.
    while (true) {
      const start = (requestedPage - 1) * pageSize

      const { data, error, count } = await supabase
        .from('stock_movements')
        .select(
          'id, movement_type, quantity_change, reason, document_reference, created_at',
          { count: 'exact' },
        )
        .eq('variant_id', props.variantId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(start, start + pageSize - 1)

      if (error) throw error
      if (!data || count === null) {
        throw new Error('Réponse incomplète pour l’historique.')
      }

      const lastPage = Math.max(1, Math.ceil(count / pageSize))

      if (requestedPage > lastPage) {
        requestedPage = lastPage
        continue
      }

      movements.value = data as Movement[]
      historyTotal.value = count
      historyPage.value = requestedPage
      break
    }
  } catch (error) {
    historyError.value = message(
      error,
      'Impossible de charger l’historique.',
    )
  } finally {
    historyLoading.value = false
  }
}

async function refresh() {
  if (saving.value || loading.value || historyLoading.value) return

  await Promise.all([loadStock(), loadHistory()])
}

async function changeHistoryPage(targetPage: number) {
  if (
    saving.value ||
    historyLoading.value ||
    targetPage < 1 ||
    targetPage > historyPageCount.value
  ) {
    return
  }

  await loadHistory(targetPage)
}

function buildPayload(): MovementPayload | null {
  const normalized = quantity.value
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.')

  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    formError.value =
      'Saisissez une quantité avec trois décimales maximum.'
    return null
  }

  const amount = Number(normalized)

  if (!Number.isFinite(amount) || amount > 99999999999.999) {
    formError.value = 'La quantité saisie est trop élevée.'
    return null
  }

  if (initialized.value && amount <= 0) {
    formError.value = 'La quantité doit être supérieure à zéro.'
    return null
  }

  if (!reason.value.trim()) {
    formError.value = 'Veuillez renseigner le motif.'
    return null
  }

  if (
    initialized.value &&
    movementType.value === 'exit' &&
    stock.value?.stock_quantity !== null &&
    stock.value?.stock_quantity !== undefined &&
    amount > stock.value.stock_quantity
  ) {
    formError.value =
      'La quantité demandée dépasse le stock disponible. Actualisez le stock si nécessaire.'
    return null
  }

  const type: MovementType = initialized.value
    ? movementType.value
    : 'initial'

  return {
    request_id: crypto.randomUUID(),
    variant_id: props.variantId,
    movement_type: type,
    quantity_change: type === 'exit' ? -amount : amount,
    reason: reason.value.trim(),
    document_reference: documentReference.value.trim() || null,
  }
}

async function saveMovement() {
  if (saving.value || loading.value || historyLoading.value) return

  formError.value = ''
  success.value = ''

  let payload = pendingMovement.value

  if (!payload) {
    if (!stock.value || !canMove.value) return

    payload = buildPayload()
    if (!payload) return

    const amount = formatQuantity(Math.abs(payload.quantity_change))

    if (
      !window.confirm(
        `${movementLabels[payload.movement_type]} : ${amount} ${
          stock.value.sales_unit || 'unités'
        } pour « ${props.variantName} ».\n\nConfirmer l’enregistrement ?`,
      )
    ) {
      return
    }

    pendingMovement.value = payload
  }

  saving.value = true

  try {
    // Avant une nouvelle tentative, vérifie si ce mouvement existe déjà.
    const { data: previous, error: lookupError } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('request_id', payload.request_id)
      .eq('variant_id', props.variantId)
      .maybeSingle()

    if (lookupError) throw lookupError

    if (!previous) {
      const {
        error: insertError,
        status,
      } = await supabase.from('stock_movements').insert(payload)

      if (insertError) {
        const { data: saved, error: checkError } = await supabase
          .from('stock_movements')
          .select('id')
          .eq('request_id', payload.request_id)
          .eq('variant_id', props.variantId)
          .maybeSingle()

        if (checkError) throw checkError

        if (!saved) {
          // Une réponse explicite de refus permet de corriger le formulaire.
          // En cas d’erreur réseau ou serveur, conserve la tentative.
          if (status >= 400 && status < 500) {
            pendingMovement.value = null
          }

          throw insertError
        }
      }
    }

    const savedType = payload.movement_type

    pendingMovement.value = null
    quantity.value = ''
    reason.value = ''
    documentReference.value = ''

    success.value =
      savedType === 'initial'
        ? 'Le stock initial a été enregistré.'
        : 'Le mouvement de stock a été enregistré.'

    await Promise.all([loadStock(), loadHistory(1)])
  } catch (error) {
    formError.value = pendingMovement.value
      ? 'La confirmation de l’enregistrement est incertaine. Cliquez sur « Vérifier et réessayer » : le même identifiant sera utilisé pour éviter un doublon.'
      : message(error, 'Impossible d’enregistrer le mouvement.')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadStock(), loadHistory(1)])
})
</script>

<template>
  <section class="stock-panel" aria-labelledby="stock-title">
    <header class="panel-header">
      <div>
        <h3 id="stock-title">Stock : {{ variantName }}</h3>
        <p class="help">
          La quantité correspond au nombre d’unités de vente disponibles.
        </p>
      </div>

      <div class="header-actions">
        <button
          type="button"
          class="secondary"
          :disabled="saving || loading || historyLoading"
          @click="refresh"
        >
          Actualiser
        </button>

        <button
          type="button"
          class="secondary"
          :disabled="saving || loading || pendingMovement !== null"
          @click="$emit('close')"
        >
          Fermer
        </button>
      </div>
    </header>

    <p v-if="success" class="success" role="status">{{ success }}</p>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>

    <p v-if="loading" role="status">Chargement du stock…</p>

    <div v-else-if="loadError">
      <p class="error" role="alert">{{ loadError }}</p>
      <button type="button" :disabled="saving" @click="loadStock">
        Réessayer
      </button>
    </div>

    <template v-else-if="stock">
      <div v-if="initialized" class="stock-value">
        <span>Quantité disponible</span>
        <strong>
          {{
            stock.stock_quantity === null
              ? 'Indisponible'
              : formatQuantity(stock.stock_quantity)
          }}
          <small>{{ stock.sales_unit || 'unités' }}</small>
        </strong>
      </div>

      <p v-if="!canMove" class="error">
        Réactivez ce format et sa fiche produit avant d’enregistrer un
        mouvement de stock.
      </p>

      <form v-else @submit.prevent="saveMovement">
        <h4>
          {{ initialized ? 'Enregistrer un mouvement' : 'Stock initial' }}
        </h4>

        <p v-if="!initialized" class="help">
          Comptez les unités réellement disponibles. Pour 4 bidons de
          10 L, saisissez 4. Saisissez 0 si aucun stock n’est disponible.
        </p>

        <template v-if="initialized">
          <label for="movement-type">Type de mouvement *</label>
          <select
            id="movement-type"
            v-model="movementType"
            :disabled="fieldsLocked"
          >
            <option value="entry">Entrée — réception de produits</option>
            <option value="exit">Sortie — vente ou utilisation</option>
            <option value="return">Retour — remise en stock</option>
          </select>

          <p class="help movement-help">
            {{
              movementType === 'exit'
                ? 'La quantité sera retirée du stock disponible.'
                : 'La quantité sera ajoutée au stock disponible.'
            }}
          </p>
        </template>

        <div class="form-grid">
          <div class="field">
            <label for="stock-quantity">
              {{
                initialized
                  ? 'Quantité du mouvement'
                  : 'Quantité disponible'
              }}
              — {{ stock.sales_unit || 'unités' }} *
            </label>
            <input
              id="stock-quantity"
              v-model="quantity"
              inputmode="decimal"
              :placeholder="initialized ? 'Ex. 4' : 'Ex. 4 ou 0'"
              :disabled="fieldsLocked"
              required
            />
          </div>

          <div class="field">
            <label for="stock-document">
              Référence du document — facultatif
            </label>
            <input
              id="stock-document"
              v-model="documentReference"
              placeholder="Ex. Facture FAC-2026-001"
              :disabled="fieldsLocked"
            />
          </div>

          <div class="field full-width">
            <label for="stock-reason">Motif *</label>
            <input
              id="stock-reason"
              v-model="reason"
              :placeholder="
                !initialized
                  ? 'Ex. Inventaire initial du magasin'
                  : movementType === 'exit'
                    ? 'Ex. Vente au client SIME'
                    : movementType === 'return'
                      ? 'Ex. Retour client — produit intact'
                      : 'Ex. Livraison du fournisseur'
              "
              :disabled="fieldsLocked"
              required
            />
          </div>
        </div>

        <p class="help">
          Un mouvement enregistré reste dans l’historique. Vérifiez la
          quantité et le motif avant de confirmer.
        </p>

        <button
          type="submit"
          :disabled="saving || historyLoading"
        >
          {{ submitLabel }}
        </button>
      </form>
    </template>

    <div v-if="pendingMovement && !canMove && !loading" class="retry-box">
      <p class="help">
        Vérifiez la tentative en attente avant de fermer ce panneau.
      </p>
      <button
        type="button"
        :disabled="saving || historyLoading"
        @click="saveMovement"
      >
        {{ saving ? 'Vérification…' : 'Vérifier et réessayer' }}
      </button>
    </div>

    <section class="history" aria-labelledby="history-title">
      <div class="history-header">
        <h4 id="history-title">Historique des mouvements</h4>
        <span class="help">{{ historyTotal }} mouvement(s)</span>
      </div>

      <p v-if="historyLoading" role="status">
        Chargement de l’historique…
      </p>

      <div v-else-if="historyError">
        <p class="error" role="alert">{{ historyError }}</p>
        <button
          type="button"
          class="secondary"
          :disabled="saving"
          @click="loadHistory()"
        >
          Réessayer
        </button>
      </div>

      <p v-else-if="movements.length === 0" class="help">
        Aucun mouvement enregistré pour ce format de vente.
      </p>

      <template v-else>
        <ul class="movement-list">
          <li v-for="movement in movements" :key="movement.id">
            <div class="movement-top">
              <div class="movement-heading">
                <span class="badge">
                  {{ movementLabels[movement.movement_type] }}
                </span>
                <time :datetime="movement.created_at">
                  {{ formatDate(movement.created_at) }}
                </time>
              </div>

              <strong
                class="movement-quantity"
                :class="{
                  negative: movement.quantity_change < 0,
                  positive: movement.quantity_change > 0,
                }"
              >
                {{ movement.quantity_change > 0 ? '+' : '' }}{{
                  formatQuantity(movement.quantity_change)
                }}
              </strong>
            </div>

            <p class="movement-reason">{{ movement.reason }}</p>
            <p v-if="movement.document_reference" class="document">
              Document : {{ movement.document_reference }}
            </p>
          </li>
        </ul>

        <nav class="pagination" aria-label="Pages de l’historique">
          <span class="help">
            {{ historyStart }}–{{ historyEnd }} sur {{ historyTotal }}
            · Page {{ historyPage }} / {{ historyPageCount }}
          </span>

          <div class="pagination-actions">
            <button
              type="button"
              class="secondary"
              :disabled="saving || historyLoading || historyPage <= 1"
              @click="changeHistoryPage(historyPage - 1)"
            >
              Précédent
            </button>
            <button
              type="button"
              class="secondary"
              :disabled="
                saving ||
                historyLoading ||
                historyPage >= historyPageCount
              "
              @click="changeHistoryPage(historyPage + 1)"
            >
              Suivant
            </button>
          </div>
        </nav>
      </template>
    </section>
  </section>
</template>

<style scoped>
.stock-panel {
  margin-top: 24px;
  padding: 24px;
  border: 1px solid #b9cfe2;
  border-radius: 14px;
  color: #172b42;
  background: #f5f9fd;
}

.panel-header,
.history-header,
.movement-top,
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

.panel-header > div:first-child {
  flex: 1 1 220px;
  min-width: 0;
}

.header-actions,
.pagination-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

h3,
h4 {
  margin: 0;
  overflow-wrap: anywhere;
}

h4 {
  font-size: 17px;
}

.help {
  color: #586a7d;
  line-height: 1.6;
}

form {
  display: grid;
  gap: 16px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #d5e1ec;
}

form > .help {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.field {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.full-width {
  grid-column: 1 / -1;
}

label {
  font-size: 14px;
  font-weight: 600;
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  margin: 0;
  padding: 12px;
  border: 1px solid #b9c7d5;
  border-radius: 10px;
  color: #172b42;
  background: white;
  font: inherit;
  font-size: 16px;
}

input:disabled,
select:disabled {
  background: #edf1f5;
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
  background: #e3edf6;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

.stock-value {
  display: grid;
  gap: 10px;
  margin-top: 20px;
  padding: 20px;
  border: 1px solid #d5e1ec;
  border-radius: 12px;
  background: white;
}

.stock-value > span {
  color: #586a7d;
}

.stock-value strong {
  font-size: 30px;
  overflow-wrap: anywhere;
}

.stock-value small {
  font-size: 16px;
  font-weight: 500;
}

.error,
.success {
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

.history {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid #d5e1ec;
}

.movement-list {
  display: grid;
  gap: 12px;
  margin: 16px 0;
  padding: 0;
  list-style: none;
}

.movement-list li {
  min-width: 0;
  padding: 16px;
  border: 1px solid #d5e1ec;
  border-radius: 12px;
  background: white;
}

.movement-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.badge {
  padding: 5px 9px;
  border-radius: 7px;
  color: #173f65;
  background: #e3edf6;
  font-size: 13px;
  font-weight: 600;
}

time,
.document {
  color: #586a7d;
  font-size: 13px;
}

.movement-quantity {
  font-size: 21px;
}

.positive {
  color: #18583c;
}

.negative {
  color: #942626;
}

.movement-reason,
.document {
  margin: 10px 0 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.pagination {
  margin-top: 18px;
}

@media (max-width: 640px) {
  .stock-panel {
    padding: 18px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .header-actions,
  .pagination-actions {
    width: 100%;
  }

  .header-actions button,
  .pagination-actions button {
    flex: 1;
  }

  form > button,
  .retry-box button {
    width: 100%;
  }

  .stock-value {
    padding: 16px;
  }
}
</style>