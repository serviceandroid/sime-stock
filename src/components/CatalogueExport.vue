<script setup lang="ts">
import { ref } from 'vue'
import { exportCatalogue } from '../lib/exportCatalogue'

const emit = defineEmits<{
  'busy-change': [value: boolean]
}>()

const showPrices = ref(true)
const exporting = ref(false)
const progress = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const warnings = ref<string[]>([])

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return 'Impossible de générer le catalogue. Vérifiez votre connexion et réessayez.'
}

async function downloadCatalogue() {
  if (exporting.value) return

  errorMessage.value = ''
  successMessage.value = ''
  warnings.value = []
  progress.value = 'Préparation du catalogue…'
  exporting.value = true
  emit('busy-change', true)

  try {
    const result = await exportCatalogue({
      showPrices: showPrices.value,
      onProgress: (text) => {
        progress.value = text
      },
    })

    warnings.value = result.warnings
    successMessage.value =
      `Le catalogue de ${result.productCount} fiche(s) a été généré. ` +
      'Le téléchargement du PDF a été lancé.'
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    exporting.value = false
    progress.value = ''
    emit('busy-change', false)
  }
}
</script>

<template>
  <section class="export-panel" aria-labelledby="export-title">
    <div class="export-header">
      <div>
        <p class="section-label">DOCUMENT COMMERCIAL</p>
        <h2 id="export-title">Catalogue PDF</h2>
      </div>

      <span class="format-badge">PDF · A4</span>
    </div>

    <p class="help">
      Générez un catalogue des produits et matériels actifs avec leurs
      photos, descriptions et formats de vente, regroupés par catégorie.
    </p>

    <label class="checkbox-label">
      <input
        v-model="showPrices"
        type="checkbox"
        :disabled="exporting"
      />
      <span>
        <strong>Afficher les prix</strong>
        <small>
          Inclure le prix actuel et l’ancien prix lorsqu’ils sont
          renseignés.
        </small>
      </span>
    </label>

    <p class="privacy-note">
      Les notes internes, les prix d’achat et les mouvements de stock
      sont exclus du document.
    </p>

    <button
      type="button"
      :disabled="exporting"
      @click="downloadCatalogue"
    >
      {{
        exporting
          ? 'Génération en cours…'
          : 'Télécharger le catalogue PDF'
      }}
    </button>

    <p v-if="exporting" class="progress" role="status" aria-live="polite">
      {{ progress }}
      <span>Gardez cette page ouverte pendant la génération.</span>
    </p>

    <p v-if="successMessage" class="success" role="status">
      {{ successMessage }}
    </p>

    <p v-if="errorMessage" class="error" role="alert">
      {{ errorMessage }}
    </p>

    <details v-if="warnings.length" class="warnings">
      <summary>
        {{ warnings.length }} point(s) à vérifier dans le catalogue
      </summary>

      <p>
        Le document a été généré. Certaines photos ou le logo n’ont
        toutefois pas pu être intégrés.
      </p>

      <ul>
        <li v-for="(warning, index) in warnings" :key="index">
          {{ warning }}
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.export-panel {
  min-width: 0;
  padding: 26px;
  border: 1px solid #c9dbea;
  border-radius: 16px;
  color: #172b42;
  background: #f5f9fd;
}

.export-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.section-label {
  margin: 0 0 8px;
  color: #526b82;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
}

h2 {
  margin: 0;
  font-size: 21px;
}

.format-badge {
  padding: 7px 11px;
  border-radius: 8px;
  color: #173f65;
  background: #e3edf6;
  font-size: 12px;
  font-weight: 700;
}

.help,
.privacy-note {
  color: #586a7d;
  line-height: 1.6;
}

.checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 20px 0;
  padding: 16px;
  border: 1px solid #dbe5ef;
  border-radius: 12px;
  background: white;
  cursor: pointer;
}

.checkbox-label input {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  min-height: 0;
  margin: 2px 0 0;
  accent-color: #173f65;
}

.checkbox-label span {
  display: grid;
  gap: 6px;
}

.checkbox-label small {
  color: #586a7d;
  font-size: 14px;
  line-height: 1.5;
}

.privacy-note {
  font-size: 13px;
}

button {
  min-height: 48px;
  padding: 12px 18px;
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

button:disabled {
  opacity: 0.65;
  cursor: wait;
}

button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

.progress {
  display: grid;
  gap: 6px;
  color: #173f65;
  line-height: 1.6;
}

.progress span {
  color: #586a7d;
  font-size: 13px;
}

.success,
.error,
.warnings {
  margin-top: 16px;
  padding: 14px;
  border-radius: 10px;
  line-height: 1.6;
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

.warnings {
  color: #755213;
  background: #fff7e5;
}

.warnings summary {
  font-weight: 600;
  cursor: pointer;
}

.warnings ul {
  max-height: 240px;
  overflow-y: auto;
  padding-left: 22px;
}

@media (max-width: 640px) {
  .export-panel {
    padding: 20px;
  }

  button {
    width: 100%;
  }
}
</style>