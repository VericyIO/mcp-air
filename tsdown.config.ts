import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  tsconfig: 'tsconfig.build.json',
  sourcemap: false,
  dts: false,
  minify: true,
  outDir: 'dist/build/',
})
