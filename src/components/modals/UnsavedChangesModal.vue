<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div
      v-if="app.unsavedChangesModalOpen"
      class="modal-backdrop unsaved-changes-backdrop"
      @mousedown.self="app.resolveUnsavedChanges('cancel')"
  >
    <section
        class="unsaved-changes-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        @keydown.esc.prevent="app.resolveUnsavedChanges('cancel')"
    >
      <div class="modal-header">
        <h2 id="unsaved-changes-title">保存当前更改？</h2>
      </div>
      <p>提供商信息尚未保存。</p>
      <div class="modal-actions unsaved-changes-actions">
        <button type="button" class="modal-cancel" @click="app.resolveUnsavedChanges('cancel')">取消切换</button>
        <button type="button" class="modal-discard" @click="app.resolveUnsavedChanges('discard')">不保存</button>
        <button type="button" class="modal-save" autofocus @click="app.resolveUnsavedChanges('save')">保存并继续</button>
      </div>
    </section>
  </div>
</template>
