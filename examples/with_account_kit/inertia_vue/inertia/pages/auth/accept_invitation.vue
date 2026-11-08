<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import ErrorSummary from '~/components/form_error_summary.vue'
import { focusFormErrorSummary } from '~/components/form_error_summary'
import AuthLayout from '~/layouts/auth.vue'
defineOptions({ layout: AuthLayout })
defineProps<{ token: string; email: string | null }>()
const fields = [
  { name: 'fullName', label: 'Full name (optional)' },
  { name: 'password', label: 'Password' },
  { name: 'passwordConfirmation', label: 'Confirm password' },
] as const
</script>

<template>
  <template v-if="!email">
    <h1 class="auth__title">This invitation can’t be used</h1>
    <p class="auth__sub">It may be invalid, already used, or expired.</p>
    <p class="auth__foot">
      Already have an account?
      <Link route="session.create" class="il">Sign in</Link>
    </p>
  </template>
  <template v-else>
    <h1 class="auth__title">Join the team</h1>
    <p class="auth__sub">
      Choose a password for <strong>{{ email }}</strong
      >. The invitation can be used once.
    </p>
    <Form
      v-slot="{ errors, processing }"
      route="invitations.update"
      :params="{ token }"
      :reset-on-error="['password', 'passwordConfirmation']"
      @error="focusFormErrorSummary"
    >
      <div class="auth__form">
        <ErrorSummary :errors="errors" :fields="fields" />
        <div v-for="field in fields" :key="field.name" class="field">
          <label class="field__label" :for="field.name">{{ field.label }}</label>
          <input
            :id="field.name"
            :name="field.name"
            :type="field.name === 'fullName' ? 'text' : 'password'"
            class="field__input"
            :autocomplete="field.name === 'fullName' ? 'name' : 'new-password'"
            :aria-invalid="errors[field.name] ? 'true' : undefined"
          />
          <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
        </div>
        <button type="submit" class="btn btn--primary btn--block" :disabled="processing">
          Create account and join
        </button>
      </div>
    </Form>
  </template>
</template>
