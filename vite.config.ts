import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { powerPointPlugin } from './server/powerpoint.ts';
import { llmPlugin } from './server/llm.ts';
export default defineConfig({ plugins: [react(), powerPointPlugin(), llmPlugin()] });
