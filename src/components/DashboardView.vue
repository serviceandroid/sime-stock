<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import ProductsView from './ProductsView.vue'

const activePage = ref<'dashboard' | 'products'>('dashboard')

defineProps<{
  fullName: string | null
  role: 'owner' | 'manager'
  signingOut: boolean
}>()

defineEmits<{
  logout: []
}>()

const loading = ref(true)
const errorMessage = ref('')
const logoUrl = ref('')

const indicators = ref([
  { label: 'Produits et matériels', value: 0 },
  { label: 'Références actives', value: 0 },
  { label: 'Stocks faibles', value: 0 },
  { label: 'Ruptures de stock', value: 0 },
  { label: 'Inventaires à renseigner', value: 0 },
])

async function loadIndicators() {
  loading.value = true
  errorMessage.value = ''

  try {
    const results = await Promise.all([
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'archived'),

      supabase
        .from('stock_summary')
        .select('variant_id', { count: 'exact', head: true })
        .eq('is_active', true)
        .neq('product_status', 'archived'),

      supabase
        .from('stock_summary')
        .select('variant_id', { count: 'exact', head: true })
        .eq('is_active', true)
        .neq('product_status', 'archived')
        .eq('stock_status', 'low_stock'),

      supabase
        .from('stock_summary')
        .select('variant_id', { count: 'exact', head: true })
        .eq('is_active', true)
        .neq('product_status', 'archived')
        .eq('stock_status', 'out_of_stock'),

      supabase
        .from('stock_summary')
        .select('variant_id', { count: 'exact', head: true })
        .eq('is_active', true)
        .neq('product_status', 'archived')
        .eq('stock_status', 'not_initialized'),
    ])

    for (const result of results) {
      if (result.error) throw result.error
      if (result.count === null) {
        throw new Error('Un indicateur n’a pas pu être calculé.')
      }
    }

    indicators.value = indicators.value.map((indicator, index) => ({
      ...indicator,
      value: results[index]!.count!,
    }))
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Impossible de charger les indicateurs.'
  } finally {
    loading.value = false
  }
}

async function loadLogo() {
  try {
    const { data: company, error } = await supabase
      .from('company_settings')
      .select('logo_path')
      .eq('id', 1)
      .maybeSingle()

    if (error || !company?.logo_path) return

    const { data, error: imageError } = await supabase.storage
      .from('company-assets')
      .download(company.logo_path)

    if (imageError || !data) return

    // Le logo est de petite taille : conservation en URL de données.
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        logoUrl.value = reader.result
      }
    }
    reader.readAsDataURL(data)
  } catch {
    // Le nom SIME reste affiché si le logo est indisponible.
  }
}

onMounted(() => {
  void loadIndicators()
  void loadLogo()
})
</script>

<template>
  <div class="dashboard">
    <aside class="sidebar">
      <div class="identity">
        <div class="logo-box">
          <img v-if="logoUrl" :src="logoUrl" alt="SIME TOGO" />
          <strong v-else>SIME TOGO</strong>
        </div>
        <span>Gestion de stock</span>
      </div>

      <nav aria-label="Navigation principale">
  <button
    :aria-current="activePage === 'dashboard' ? 'page' : undefined"
    @click="activePage = 'dashboard'"
  >
    Tableau de bord
  </button>

  <button
    :aria-current="activePage === 'products' ? 'page' : undefined"
    @click="activePage = 'products'"
  >
    Produits et matériels
  </button>
</nav>

      <div class="sidebar-footer">
        <strong>{{ fullName || 'Équipe SIME' }}</strong>
        <span>
          {{
            role === 'owner'
              ? 'Administrateur principal'
              : 'Gestionnaire'
          }}
        </span>
        <button
          class="logout-button"
          :disabled="signingOut"
          @click="$emit('logout')"
        >
          {{ signingOut ? 'Déconnexion…' : 'Se déconnecter' }}
        </button>
      </div>
    </aside>

    <main id="dashboard" class="content">
    <ProductsView v-if="activePage === 'products'" />

    <template v-else>
      <header class="page-header">
        <div>
          <p class="section-label">ESPACE DE GESTION SIME</p>
          <h1>Tableau de bord</h1>
          <p class="subtitle">
            Retrouvez l’état de votre catalogue et de vos stocks.
          </p>
        </div>

        <button
          class="refresh-button"
          :disabled="loading"
          @click="loadIndicators"
        >
          {{ loading ? 'Chargement…' : 'Actualiser' }}
        </button>
      </header>

      <p v-if="errorMessage" class="dashboard-error" role="alert">
        Les indicateurs sont indisponibles : {{ errorMessage }}
      </p>

      <section
        v-else
        class="indicator-grid"
        aria-label="Indicateurs de stock"
        :aria-busy="loading"
      >
        <article
          v-for="indicator in indicators"
          :key="indicator.label"
          class="indicator"
        >
          <p>{{ indicator.label }}</p>
          <strong>{{ loading ? '…' : indicator.value }}</strong>
        </article>
      </section>

      <section class="overview">
        <div class="overview-heading">
          <p class="section-label">VOTRE CATALOGUE</p>
          <h2>Produits, matériels et conditionnements</h2>
        </div>

        <p v-if="loading" role="status">
          Chargement des données…
        </p>
        <p v-else-if="errorMessage">
          Cliquez sur Actualiser pour réessayer.
        </p>
        <p v-else-if="indicators[0]?.value === 0">
          Aucun produit enregistré pour le moment.
          Nous ajouterons les fiches et importerons votre fichier Excel
          dans les prochaines étapes.
        </p>
        <p v-else>
          Votre catalogue contient
          {{ indicators[0]?.value }} produit(s) et matériel(s).
        </p>
      </section>

      <p class="stock-note">
        Les stocks faibles et ruptures concernent les références dont
        l’inventaire initial a été renseigné.
      </p>
    </template>
    </main>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  background: #f3f6fa;
  color: #172b42;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 36px;
  padding: 28px 22px;
  background: #122d47;
  color: #fff;
}

.identity {
  display: grid;
  gap: 12px;
}

.logo-box {
  display: grid;
  place-items: center;
  min-height: 72px;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  color: #122d47;
}

.logo-box img {
  display: block;
  max-width: 100%;
  width: 150px;
  height: 50px;
  object-fit: contain;
}

.identity > span,
.sidebar-footer > span {
  color: #c1d1df;
  font-size: 13px;
}

nav a {
  display: block;
  padding: 14px;
  border-radius: 10px;
  color: #fff;
  background: #264963;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.sidebar-footer {
  display: grid;
  gap: 10px;
  margin-top: auto;
  overflow-wrap: anywhere;
}

.sidebar-footer strong {
  font-size: 14px;
}

.logout-button {
  margin-top: 8px;
  background: #264963;
}

.content {
  min-width: 0;
  padding: clamp(22px, 4vw, 48px);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 32px;
}

.section-label {
  margin: 0 0 10px;
  color: #526b82;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
}

h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 36px);
}

.subtitle {
  margin: 12px 0 0;
  color: #586a7d;
  line-height: 1.6;
}

.refresh-button {
  flex-shrink: 0;
  width: auto;
}

.indicator-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 16px;
}

.indicator,
.overview {
  border: 1px solid #e0e7ef;
  border-radius: 16px;
  background: #fff;
}

.indicator {
  padding: 24px;
}

.indicator p {
  margin: 0 0 20px;
  color: #526579;
  font-size: 14px;
  line-height: 1.5;
}

.indicator strong {
  font-size: 36px;
}

.overview {
  margin-top: 28px;
  padding: 28px;
}

h2 {
  margin: 0;
  font-size: 21px;
  line-height: 1.4;
}

.overview > p {
  max-width: 720px;
  margin: 20px 0 0;
  color: #586a7d;
  line-height: 1.7;
}

.stock-note {
  margin-top: 20px;
  color: #586a7d;
  font-size: 13px;
  line-height: 1.6;
}

.dashboard-error {
  padding: 16px;
  color: #942626;
  background: #fff0f0;
  border-radius: 12px;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .dashboard {
    grid-template-columns: 200px minmax(0, 1fr);
  }

  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .dashboard {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    gap: 20px;
    padding: 20px;
  }

  .identity {
    grid-template-columns: 150px 1fr;
    align-items: center;
  }

  .sidebar-footer {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .sidebar-footer > span {
    grid-column: 1;
  }

  .logout-button {
    grid-column: 2;
    grid-row: 1 / 3;
    width: auto;
    margin: 0;
    font-size: 13px;
  }

  .indicator-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .indicator {
    padding: 18px;
  }

  .overview {
    padding: 22px;
  }
}

@media (max-width: 360px) {
  .indicator-grid,
  .sidebar-footer {
    grid-template-columns: minmax(0, 1fr);
  }

  .logout-button {
    grid-column: 1;
    grid-row: auto;
  }
}

nav {
  display: grid;
  gap: 10px;
}

nav button {
  text-align: left;
  background: transparent;
  color: #d1dfeb;
}

nav button[aria-current='page'],
nav button:hover:not(:disabled) {
  background: #264963;
  color: white;
}
</style>