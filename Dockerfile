FROM node:20
WORKDIR /app

# 1. Copia os arquivos de dependências
COPY package*.json ./

# 2. Copia a pasta prisma
COPY prisma ./prisma/

# 3. Instala as dependências
RUN npm install

# 4. Copia o restante dos arquivos do projeto
COPY . .

# 5. Build do projeto
RUN npm run build

# 6. DEBUG - Mostra a estrutura da pasta dist
RUN echo "=== Conteúdo da pasta dist ===" && ls -la dist/ && echo "=== Fim do debug ==="

EXPOSE 3000

# 7. Executa migrations e inicia em modo produção
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
