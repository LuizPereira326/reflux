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
RUN npm run build || echo "Build skipped"

EXPOSE 3000

# 6. Executa migrations e inicia a aplicação
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
