<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/app.vue'
defineOptions({ layout: AppLayout })
defineProps<{
  team: { id: number; name: string }
  role: string
  members: { email: string; role: string }[]
  canWrite: boolean
  canInvite: boolean
  invitableRoles: string[]
}>()
</script>

<template>
  <section class="page">
    <Head :title="team.name" />
    <header class="page__header">
      <h1 class="page__title">{{ team.name }}</h1>
    </header>
    <p>
      Your role: <strong>{{ role }}</strong
      >.
    </p>

    <template v-if="canWrite">
      <h2>Rename the team</h2>
      <Form v-slot="{ errors, processing }" route="teams.update" :params="{ scopeId: team.id }">
        <div class="auth__form">
          <div class="field">
            <label class="field__label" for="name">Team name</label>
            <input
              id="name"
              name="name"
              type="text"
              class="field__input"
              :value="team.name"
              required
            />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <button type="submit" class="btn btn--primary" :disabled="processing">Rename team</button>
        </div>
      </Form>
    </template>

    <h2>Members</h2>
    <ul>
      <li v-for="member in members" :key="member.email">{{ member.email }} ({{ member.role }})</li>
    </ul>

    <template v-if="canInvite">
      <h2>Invite a member</h2>
      <Form
        v-slot="{ errors, processing }"
        route="team_invitations.store"
        :params="{ scopeId: team.id }"
        reset-on-success
      >
        <div class="auth__form">
          <div class="field">
            <label class="field__label" for="email">Email</label>
            <input id="email" name="email" type="email" class="field__input" required />
            <span v-if="errors.email" class="field__error">{{ errors.email }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="role">Role</label>
            <select id="role" name="role" class="field__input">
              <option v-for="option in invitableRoles" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            Send invitation
          </button>
        </div>
      </Form>
    </template>
  </section>
</template>
