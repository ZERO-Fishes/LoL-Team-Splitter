import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/LoL-Team-Splitter/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
