FROM e2bdev/code-interpreter:latest

WORKDIR /home/user

RUN yes "no" | npm create vite@latest . -- --template react && \
    npm install


RUN npm install lucide-react
RUN npm install -D tailwindcss@3 postcss autoprefixer
RUN npx tailwindcss init -p

RUN echo "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    allowedHosts: true\n  }\n})" > vite.config.js

RUN echo '@tailwind base;\n@tailwind components;\n@tailwind utilities;' > src/index.css

RUN echo '/** @type {import("tailwindcss").Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}' > tailwind.config.js
