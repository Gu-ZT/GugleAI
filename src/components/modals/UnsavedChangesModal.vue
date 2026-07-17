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
        <a-button class="modal-cancel" @click="app.resolveUnsavedChanges('cancel')">取消切换</a-button>
        <a-button status="danger" class="modal-discard" @click="app.resolveUnsavedChanges('discard')">不保存</a-button>
        <a-button type="primary" class="modal-save" autofocus @click="app.resolveUnsavedChanges('save')">保存并继续</a-button>
      </div>
    </section>
  </div>
</template>
