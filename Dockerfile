FROM node:20

WORKDIR /app

# 1. Copia os arquivos de dependências
COPY package*.json ./

# 2. COPIA A PASTA PRISMA AGORA (Isso evita o erro que você teve)
COPY prisma ./prisma/

# 3. Instala as dependências (agora o prisma generate vai encontrar o schema)
RUN npm install

# 4. Copia o restante dos arquivos do projeto
COPY . .

# 5. Build do projeto (se necessário)
RUN npm run build || echo "Build skipped"

EXPOSE 3000

CMD ["npm", "start"]
