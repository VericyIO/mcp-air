import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/http.ts', 'src/server.ts'],
  tsconfig: 'tsconfig.build.json',
  sourcemap: false,
  dts: false,
  minify: true,
  outDir: 'dist/build/',
})
