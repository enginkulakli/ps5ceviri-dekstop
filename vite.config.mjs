import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { license: { fileName: "THIRD-PARTY-LICENSES.md" } },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: "@", replacement: fileURLToPath(new URL(".", import.meta.url)) },
    ],
  },
});
