<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from './lib/supabase'
import DashboardView from './components/DashboardView.vue'

type Profile = {
  full_name: string | null
  role: 'owner' | 'manager'
  is_active: boolean
}

const email = ref('')
const password = ref('')
const profile = ref<Profile | null>(null)
const loading = ref(false)
const initializing = ref(true)
const errorMessage = ref('')

async function loadProfile(userId: string) {
  profile.value = null

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Lecture du profil impossible : ${error.message}`)
  }

  if (
    !data?.is_active ||
    !['owner', 'manager'].includes(data.role)
  ) {
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error(
      'Ce compte ne dispose pas d’un accès actif. Contactez l’administrateur.',
    )
  }

  profile.value = data as Profile
}

async function login() {
  if (loading.value) return

  loading.value = true
  errorMessage.value = ''
  profile.value = null

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    })

    if (error) {
      throw new Error(
        error.code === 'invalid_credentials'
          ? 'Email ou mot de passe incorrect.'
          : `Connexion impossible : ${error.message}`,
      )
    }

    if (!data.user) {
      throw new Error('Connexion impossible. Réessayez.')
    }

    await loadProfile(data.user.id)
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Une erreur est survenue. Réessayez.'
  } finally {
    password.value = ''
    loading.value = false
  }
}

async function logout() {
  loading.value = true
  errorMessage.value = ''

  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error

    profile.value = null
    password.value = ''
  } catch {
    errorMessage.value = 'Déconnexion impossible. Réessayez.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession()

    if (sessionError) throw sessionError

    if (sessionData.session) {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      if (data.user) await loadProfile(data.user.id)
    }
  } catch (error) {
    profile.value = null
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Impossible de restaurer la connexion.'
  } finally {
    initializing.value = false
  }
})
</script>

<template>
  <template v-if="profile && !initializing">
    <DashboardView
      :full-name="profile.full_name"
      :role="profile.role"
      :signing-out="loading"
      @logout="logout"
    />

    <p v-if="errorMessage" class="error" role="alert">
      {{ errorMessage }}
    </p>
  </template>

  <main v-else class="auth-page">
    <section class="auth-card" aria-labelledby="page-title">
      <div class="brand">SIME<span>TOGO</span></div>
      <p class="eyebrow">GESTION DE STOCK</p>

      <p v-if="initializing" role="status">
        Vérification de votre connexion…
      </p>

      <template v-else>
        <h1 id="page-title">Bienvenue</h1>
        <p class="intro">
          Connectez-vous à votre espace de gestion SIME.
        </p>

        <form @submit.prevent="login">
          <label for="email">Adresse email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="username"
            :disabled="loading"
            required
          />

          <label for="password">Mot de passe</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="loading"
            required
          />

          <button type="submit" :disabled="loading">
            {{ loading ? 'Connexion en cours…' : 'Se connecter' }}
          </button>
        </form>
      </template>

      <p v-if="errorMessage" class="error" role="alert">
        {{ errorMessage }}
      </p>

      <footer>Espace réservé à l’équipe SIME</footer>
    </section>
  </main>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  color: #172b42;
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #f3f6fa;
}

button,
input {
  font: inherit;
}

.auth-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, #dceaf5, transparent 55%),
    #f3f6fa;
}

.auth-card {
  width: 100%;
  max-width: 460px;
  padding: 40px;
  background: #fff;
  border: 1px solid #e0e7ef;
  border-radius: 24px;
  box-shadow: 0 20px 65px #172b4210;
}

.brand {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 2px;
}

.brand span {
  margin-left: 8px;
  color: #536c83;
  font-size: 13px;
  letter-spacing: 1px;
}

.eyebrow {
  margin: 8px 0 32px;
  color: #526b82;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
}

h1 {
  margin: 0 0 12px;
  font-size: clamp(26px, 5vw, 32px);
}

.intro {
  margin: 0 0 28px;
  color: #586a7d;
  line-height: 1.6;
}

form {
  display: grid;
  gap: 10px;
}

label {
  font-size: 14px;
  font-weight: 600;
}

input {
  width: 100%;
  min-height: 48px;
  margin-bottom: 12px;
  padding: 12px 14px;
  color: #172b42;
  background: #fff;
  border: 1px solid #b9c7d5;
  border-radius: 10px;
  font-size: 16px;
}

input:focus-visible,
button:focus-visible {
  outline: 3px solid #89b9df;
  outline-offset: 3px;
}

button {
  width: 100%;
  min-height: 48px;
  padding: 12px 16px;
  color: #fff;
  background: #173f65;
  border: 0;
  border-radius: 10px;
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

.account-details {
  display: grid;
  gap: 8px;
  padding: 18px;
  background: #f3f6fa;
  border-radius: 12px;
}

.account-details span {
  color: #586a7d;
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

footer {
  margin-top: 28px;
  color: #586a7d;
  font-size: 12px;
  text-align: center;
}

@media (max-width: 480px) {
  .auth-page {
    padding: 16px;
  }

  .auth-card {
    padding: 28px 22px;
    border-radius: 18px;
  }
}
</style>