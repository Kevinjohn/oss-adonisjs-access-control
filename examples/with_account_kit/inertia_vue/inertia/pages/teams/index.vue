<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/app.vue'
defineOptions({ layout: AppLayout })
defineProps<{ teams: { id: number; name: string; role: string }[] }>()
</script>

<template>
  <section class="page">
    <Head title="Your teams" />
    <header class="page__header">
      <h1 class="page__title">Your teams</h1>
    </header>
    <ul v-if="teams.length > 0">
      <li v-for="team in teams" :key="team.id">
        <Link route="teams.show" :params="{ scopeId: team.id }">{{ team.name }}</Link>
        ({{ team.role }})
      </li>
    </ul>
    <p v-else>You are not in a team yet. Create one, or ask a team admin to invite you.</p>

    <h2>Create a team</h2>
    <Form v-slot="{ errors, processing }" route="teams.store">
      <div class="auth__form">
        <div class="field">
          <label class="field__label" for="name">Team name</label>
          <input id="name" name="name" type="text" class="field__input" required />
          <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
        </div>
        <button type="submit" class="btn btn--primary" :disabled="processing">Create team</button>
      </div>
    </Form>
  </section>
</template>
