<script setup lang="ts">
defineProps<{variables: Array<{token: string; description: string}>}>();
</script>

<template>
  <section class="prompt-variables">
    <h4>可用变量</h4>
    <div class="prompt-variable-list">
      <div v-for="variable in variables" :key="variable.token" class="prompt-variable-row">
        <code>{{ variable.token }}</code>
        <span>{{ variable.description }}</span>
      </div>
    </div>
  </section>
</template>
