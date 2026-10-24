import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { powerPointPlugin } from './server/powerpoint.ts';
export default defineConfig({ plugins: [react(), powerPointPlugin()] });
